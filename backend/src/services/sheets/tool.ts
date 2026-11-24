import { tool } from 'ai';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { prisma } from '../../prisma.js';
import { redis } from '../../redis.js';
import { getSheetsClient } from './client.js';
import { invalidateSlots, readSlots } from './read.js';
import { upcomingFreeSlots } from './schedule.js';
import { getSheetsSettings } from './settings.js';
import type { Lang } from './language.js';
import type { Slot } from './types.js';

/** A real person's name has letters (not just an emoji or a phone number) and the phone has 10-15 digits. */
function detailsLookReal(name: string, phone: string): boolean {
  const letters = name.match(/\p{L}/gu)?.length ?? 0;
  const digits = phone.replace(/\D/g, '').length;
  return letters >= 2 && digits >= 10 && digits <= 15;
}

export type BookStatus = 'booked' | 'taken' | 'not_found' | 'missing_details' | 'error';

/**
 * Columns E (записал) and F (источник) are dropdowns in the clinic's sheet: the values
 * `AI` and `WhatsApp` must exist in those lists, otherwise the sheet may refuse them.
 */
const BOOKED_BY = 'AI';
const SOURCE = 'WhatsApp';
const MAX_SLOTS_IN_CONFLICT_REPLY = 5;

const LOCK_TTL_MS = 15_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 50;

/**
 * One booking at a time per tenant, across all conversations: the re-check and the write must not interleave
 * with another client's booking of the same slot.
 */
async function withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const key = `sheets:lock:${tenantId}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  while ((await redis.set(key, '1', 'PX', LOCK_TTL_MS, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new Error('could not get the booking lock');
    await new Promise((r) => setTimeout(r, LOCK_POLL_MS));
  }
  try {
    return await fn();
  } finally {
    await redis.del(key);
  }
}

export async function bookSlot(args: {
  tenantId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  comment?: string;
}): Promise<{ status: BookStatus }> {
  const { tenantId, date, time, name, phone, comment } = args;
  // A row without name and phone still counts as free, so an empty booking would be reported but never held.
  if (!detailsLookReal(name, phone)) return { status: 'missing_details' };
  try {
    return await withTenantLock(tenantId, () => writeBooking(args));
  } catch (err) {
    logger.error({ err, tenantId }, 'sheets booking failed');
    return { status: 'error' };
  }
}

async function writeBooking(args: {
  tenantId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  comment?: string;
}): Promise<{ status: BookStatus }> {
  const { tenantId, date, time, name, phone, comment } = args;
  {
    const settings = await getSheetsSettings(tenantId);
    // Re-read right before writing: a person may have filled the slot after the prompt was built.
    const slots = await readSlots(tenantId, { fresh: true });
    const slot = slots.find((s) => s.date === date && s.time === time);
    if (!slot) return { status: 'not_found' };
    // Only slots the prompt could offer: not in the past and inside the booking window.
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    const open = upcomingFreeSlots(
      slots.map((s) => ({ ...s, free: true })),
      new Date(),
      tenant?.timezone ?? 'Asia/Almaty',
      settings.daysAhead,
    );
    if (!open.some((s) => s.date === date && s.time === time)) return { status: 'not_found' };
    if (!slot.free) return { status: 'taken' };

    const client = getSheetsClient();
    if (!client || !settings.spreadsheetId || !settings.sheetName) return { status: 'error' };
    const sheet = settings.sheetName;
    const data = [
      { range: `${sheet}!B${slot.row}:C${slot.row}`, values: [[name, phone]] },
      ...(comment?.trim() ? [{ range: `${sheet}!D${slot.row}`, values: [[comment.trim()]] }] : []),
      { range: `${sheet}!E${slot.row}:F${slot.row}`, values: [[BOOKED_BY, SOURCE]] },
    ];
    // RAW keeps "+7 707 ..." as text instead of letting Sheets turn it into a number or formula.
    await client.spreadsheets.values.batchUpdate({
      spreadsheetId: settings.spreadsheetId,
      requestBody: { valueInputOption: 'RAW', data },
    });
    await invalidateSlots(tenantId);
    return { status: 'booked' };
  }
}

export function buildSheetsTool(ctx: { tenantId: string }) {
  const state = {
    conflict: false,
    missingDetails: false,
    failed: false,
    booked: false,
    lastBooking: null as { date: string; time: string } | null,
  };
  // The SDK runs the tool calls of one step in parallel; book one at a time so the re-check sees the previous write.
  let chain: Promise<unknown> = Promise.resolve();
  const bookTool = tool({
    description:
      'Book the client into a free slot of the clinic schedule. Call it only after the client chose a time from the list and gave their name and phone number.',
    parameters: z.object({
      date: z.string().describe('Date of the slot, YYYY-MM-DD, exactly as in the list'),
      time: z.string().describe('Time of the slot, HH:mm, exactly as in the list'),
      name: z.string().describe("Client's full name"),
      phone: z.string().describe("Client's phone number"),
      comment: z.string().optional().describe('Short note from the client, only if they gave one'),
    }),
    execute: (input) => {
      const run = chain.then(async () => {
        const res = await bookSlot({ tenantId: ctx.tenantId, ...input });
        if (res.status === 'booked') {
          state.booked = true;
          state.lastBooking = { date: input.date, time: input.time };
        }
        if (res.status === 'taken' || res.status === 'not_found') state.conflict = true;
        if (res.status === 'missing_details') state.missingDetails = true;
        if (res.status === 'error') state.failed = true;
        return res;
      });
      chain = run.catch(() => undefined);
      return run;
    },
  });
  return { tool: bookTool, state };
}

function groupByDate(slots: Slot[]): string {
  const byDate = new Map<string, string[]>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s.time]);
  return [...byDate].map(([date, times]) => `- ${date}: ${times.join(', ')}`).join('\n');
}

export function sheetsPromptSection(freeSlots: Slot[]): string {
  const list = freeSlots.length ? groupByDate(freeSlots) : '(no free slots in the coming days)';
  return `\n\nBOOKING: you can book the client into the clinic schedule with the book_slot tool. Free slots (date: times):\n${list}
Rules:
- Offer only times from this list. Never invent a time.
- When the client asks whether there is room (for a day, "tomorrow", "are there free times") or wants to book, and has not said a time or a part of the day, your first reply is only the question: do they prefer morning or afternoon (morning = before 12:00, afternoon = from 12:00)? Do not name any time in that first reply. Only after the answer offer one or two free times of that part of the day, the earliest ones; never list the whole schedule. If the client does not like them, offer the next one or two. If the client already named a time or a part of the day, skip the question.
- Before booking you need the client's full name (first and last name, as it should be written in the schedule) and phone number. Ask for both in one message and always ask for the name, even if you can see the WhatsApp profile name. Never use the WhatsApp profile name and never guess a name.
- Tool result "missing_details": the name or phone was not real; ask the client for them again.
- Call book_slot only after the client chose a time. Use the date and time exactly as in the list.
- Tool result "booked": confirm the date and time in one short sentence.
- Never say the client is booked unless the tool returned "booked".
- If there are no free slots, say a manager will contact the client.`;
}

export function sheetsUnavailablePrompt(): string {
  return '\n\nBOOKING: the clinic schedule cannot be read right now. Do not offer or promise any appointment time; tell the client a manager will contact them shortly.';
}

const dayMonth = (date: string) => `${date.slice(8)}.${date.slice(5, 7)}`;

/** Our own reply when the chosen slot was taken before the write: the model's text must not claim a booking. */
export function conflictReply(freeSlots: Slot[], lang: Lang = 'ru'): string {
  if (!freeSlots.length) {
    return lang === 'kk'
      ? 'Бұл уақыт бос емес. Қазір бос уақыт жоқ — менеджеріміз сізбен байланысып, уақыт таңдап береді.'
      : 'Это время уже занято. Свободных окон сейчас нет — наш менеджер свяжется с вами и подберёт время.';
  }
  const list = freeSlots
    .slice(0, MAX_SLOTS_IN_CONFLICT_REPLY)
    .map((s) => (lang === 'kk' ? `${dayMonth(s.date)} күні ${s.time}` : `${dayMonth(s.date)} в ${s.time}`))
    .join('\n');
  return lang === 'kk'
    ? `Бұл уақыт бос емес. Бос уақыттар:\n${list}\nҚайсысы ыңғайлы екенін жазыңыз.`
    : `Это время уже занято. Свободно:\n${list}\nНапишите, какое время вам подходит.`;
}

/** Our own confirmation: on Google the model's text is written before it sees the result, and it can be empty. */
export function bookedReply(b: { date: string; time: string }, lang: Lang = 'ru'): string {
  return lang === 'kk'
    ? `Сізді ${dayMonth(b.date)} күні сағат ${b.time}-ге жаздым. Күтеміз!`
    : `Записала вас на ${dayMonth(b.date)} в ${b.time}. Ждём вас!`;
}

/** Our own reply when the schedule could not be written: a manager takes over. */
export function failedReply(lang: Lang = 'ru'): string {
  return lang === 'kk'
    ? 'Автоматты түрде жаза алмадым. Біздің менеджер сізбен байланысып, жазылуды растайды.'
    : 'Не получилось записать вас автоматически. Наш менеджер свяжется с вами и подтвердит запись.';
}

/** Our own reply when the name or phone was missing or not real: ask again instead of confirming. */
export function needDetailsReply(lang: Lang = 'ru'): string {
  return lang === 'kk'
    ? 'Сізді жазу үшін толық аты-жөніңізді және телефон нөміріңізді жазыңыз.'
    : 'Чтобы записать вас, напишите, пожалуйста, ваше полное имя и номер телефона.';
}
