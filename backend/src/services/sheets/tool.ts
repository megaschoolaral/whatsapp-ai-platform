import { tool } from 'ai';
import { z } from 'zod';
import { logger } from '../../logger.js';
import { getSheetsClient } from './client.js';
import { invalidateSlots, readSlots } from './read.js';
import { getSheetsSettings } from './settings.js';
import type { Slot } from './types.js';

export type BookStatus = 'booked' | 'taken' | 'not_found' | 'error';

/**
 * Columns E (записал) and F (источник) are dropdowns in the clinic's sheet: the values
 * `AI` and `WhatsApp` must exist in those lists, otherwise the sheet may refuse them.
 */
const BOOKED_BY = 'AI';
const SOURCE = 'WhatsApp';
const MAX_SLOTS_IN_CONFLICT_REPLY = 5;

export async function bookSlot(args: {
  tenantId: string;
  date: string;
  time: string;
  name: string;
  phone: string;
  comment?: string;
}): Promise<{ status: BookStatus }> {
  const { tenantId, date, time, name, phone, comment } = args;
  try {
    // Re-read right before writing: a person may have filled the slot after the prompt was built.
    const slot = (await readSlots(tenantId, { fresh: true })).find((s) => s.date === date && s.time === time);
    if (!slot) return { status: 'not_found' };
    if (!slot.free) return { status: 'taken' };

    const settings = await getSheetsSettings(tenantId);
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
  } catch (err) {
    logger.error({ err, tenantId }, 'sheets booking failed');
    return { status: 'error' };
  }
}

export function buildSheetsTool(ctx: { tenantId: string }) {
  const state = { conflict: false, failed: false, booked: false };
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
        if (res.status === 'booked') state.booked = true;
        if (res.status === 'taken' || res.status === 'not_found') state.conflict = true;
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
- Before booking, make sure you know the client's name and phone number; ask for what is missing.
- Call book_slot only after the client chose a time. Use the date and time exactly as in the list.
- Tool result "booked": confirm the date and time in one short sentence.
- Never say the client is booked unless the tool returned "booked".
- If there are no free slots, say a manager will contact the client.`;
}

export function sheetsUnavailablePrompt(): string {
  return '\n\nBOOKING: the clinic schedule cannot be read right now. Do not offer or promise any appointment time; tell the client a manager will contact them shortly.';
}

/** Our own reply when the chosen slot was taken before the write: the model's text must not claim a booking. */
export function conflictReply(freeSlots: Slot[]): string {
  if (!freeSlots.length) {
    return 'Это время уже занято. Свободных окон сейчас нет — наш менеджер свяжется с вами и подберёт время.';
  }
  const list = freeSlots
    .slice(0, MAX_SLOTS_IN_CONFLICT_REPLY)
    .map((s) => `${s.date} в ${s.time}`)
    .join('\n');
  return `Это время уже занято. Свободно:\n${list}\nНапишите, какое время вам подходит.`;
}

/** Our own reply when the schedule could not be written: a manager takes over. */
export function failedReply(): string {
  return 'Не получилось записать вас автоматически. Наш менеджер свяжется с вами и подтвердит запись.';
}
