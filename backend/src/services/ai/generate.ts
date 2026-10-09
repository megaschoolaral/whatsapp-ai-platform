import { generateText, type CoreMessage } from 'ai';
import { resolveTextModel, resolveVisionModel } from './providers.js';
import { logTextUsage, logVisionUsage } from './usageLog.js';
import { queryCorpus } from './rag.js';
import { prisma } from '../../prisma.js';
import { logger } from '../../logger.js';
import { bookAppointmentTool } from './tools/bookAppointment.js';
import { checkAvailabilityTool } from './tools/checkAvailability.js';
import { rescheduleAppointmentTool, cancelAppointmentTool } from './tools/manageAppointment.js';
import { formatLocalDate } from '../calendar/timeUtils.js';
import type { TenantContext } from '../tenantContext.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateReplyArgs {
  tenant: TenantContext;
  history: ChatTurn[];
  userMessage: string;
  imageBase64?: string | null;   // for vision flow
  imageMimeType?: string | null;
  conversationId?: string | null;
  clientPhone?: string | null;
}

export interface GenerateReplyResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  ragUsed: boolean;
}

function systemMessage(tenant: TenantContext, ragContext: string, isFirstMessage: boolean, hasCalendar: boolean): string {
  const now = new Date().toLocaleString('ru-RU', { timeZone: tenant.timezone });
  let sys = tenant.aiPersona || 'You are a helpful assistant for a small business.';
  const today = formatLocalDate(new Date(), tenant.timezone);
  sys += `\n\nCurrent time: ${now}\nToday's date (YYYY-MM-DD): ${today}\nTimezone: ${tenant.timezone}`;
  sys += `\n\nIMPORTANT RULE: Do not ask the client unnecessary questions. Only answer what they ask. If the client's message is unclear, give the most helpful answer you can based on what you know. The only exception: when the client wants to book an appointment, you MUST ask for any missing booking details (see below), and you may ask other questions that your persona instructions explicitly require.`;
  if (hasCalendar) {
    sys += `\n\nYou can book appointments directly using the book_appointment tool once the client has confirmed a specific date and time and you have their name, their phone number and the service. If any of these is missing, ask the client for it before booking — never invent or guess them. Every appointment is exactly 60 minutes. If the tool says the slot is taken, suggest a different time instead of retrying the same slot.`;
    sys += `\n\nCHANGES RULE: If the client wants to move/reschedule their appointment, call reschedule_appointment directly with the new date and time (it checks that the new time is free itself, so do NOT call check_availability or book_appointment for it, and never create a second booking for that). If the client wants to cancel, use cancel_appointment. These only work on the client's own upcoming appointment from this conversation. Do not call them until the client has clearly said what they want (and the exact new date and time for a reschedule).`;
    sys += `\n\nAVAILABILITY RULE: You cannot know which times are free on your own. Before telling the client that a time is free or taken, and before proposing alternative times, call the check_availability tool for that date (pass the working hours from your instructions as workStart/workEnd if they are given). Offer only times that the tool returned as free; never invent availability.`;
  }
  sys += isFirstMessage
    ? `\n\nIMPORTANT RULE: This is the first message in the conversation — greet the client briefly.`
    : `\n\nIMPORTANT RULE: This is NOT the first message in the conversation — do NOT greet the client again (no "Здравствуйте"/"Сәлеметсіз бе" etc.), answer the question directly.`;
  if (ragContext) {
    sys += `\n\nRelevant info from knowledge base (use only if relevant):\n${ragContext}`;
  }
  return sys;
}

const GREETING_PREFIX_RE =
  /^\s*(сәлеметсіз\s*бе|сәлеметсізбе|здравствуйте|добрый\s+день|доброе\s+утро|добрый\s+вечер|привет)[!.,\s-]*/i;

function stripRepeatedGreeting(text: string, isFirstMessage: boolean): string {
  if (isFirstMessage) return text;
  const stripped = text.replace(GREETING_PREFIX_RE, '');
  return stripped.trim() || text;
}

type BookingOutcome =
  | { ok: true; startAt: string; endAt: string }
  | { ok: false; reason: 'not_connected' | 'invalid_time' | 'slot_taken' | 'calendar_error' };

type AvailabilityOutcome =
  | {
      ok: true;
      date: string;
      timezone: string;
      slotMinutes: number;
      busy: Array<{ from: string; to: string }>;
      freeStartTimes: string[];
    }
  | { ok: false; reason: 'not_connected' | 'calendar_error' | 'invalid_input' };

interface TextModel {
  meta: { provider: string; supportsVision: boolean };
  sdkModel: Parameters<typeof generateText>[0]['model'];
}

/**
 * If the model called a calendar tool, the AI SDK's built-in multi-step continuation
 * (re-sending the assistant's functionCall turn) fails against Gemini 3 models with
 * "missing a thought_signature" — a gap in this SDK version's Gemini-3 support. Instead
 * of relying on that continuation, we do our own plain-text follow-up call: no functionCall/
 * functionResponse parts involved, so the thought_signature requirement never applies.
 */
type RescheduleOutcome =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: 'invalid_time' | 'in_past' | 'not_connected' | 'not_found' | 'slot_taken' | 'calendar_error' }
  | { ok: false; reason: 'multiple'; options: string[] };

type CancelOutcome =
  | { ok: true; was: string }
  | { ok: false; reason: 'not_connected' | 'not_found' | 'calendar_error' }
  | { ok: false; reason: 'multiple'; options: string[] };

const TECH_PROBLEM_NOTE =
  'a technical problem occurred. Apologize briefly and ask the client to try again in a few minutes. Do not mention any manager or manual confirmation. Reply in their language.';

function manageNote(
  kind: 'reschedule' | 'cancel',
  outcome: RescheduleOutcome | CancelOutcome,
): string {
  if (outcome.ok) {
    return kind === 'reschedule'
      ? `[System note: the appointment was moved from ${(outcome as { from: string }).from} to ${(outcome as { to: string }).to} (local time). Confirm this to the client briefly, in their language.]`
      : `[System note: the appointment on ${(outcome as { was: string }).was} (local time) was cancelled. Confirm this to the client briefly and say they are welcome to book again, in their language.]`;
  }
  switch (outcome.reason) {
    case 'not_found':
      return `[System note: the client has no upcoming appointment that could be changed. Tell them so briefly and offer to book a new one, in their language.]`;
    case 'multiple':
      return `[System note: the client has several upcoming appointments: ${outcome.options.join(', ')} (local time). Ask which one they mean, in their language, then use that exact start time.]`;
    case 'slot_taken':
      return `[System note: the new time is already taken. Apologize briefly, then call check_availability for that day and offer the 2-3 nearest free times, in their language.]`;
    case 'in_past':
      return `[System note: the new time is in the past. Ask the client for a future date and time, in their language.]`;
    case 'invalid_time':
      return `[System note: the new date/time could not be understood. Ask the client to restate the exact date and time, in their language.]`;
    default:
      return `[System note: ${TECH_PROBLEM_NOTE}]`;
  }
}

type ToolSet = Parameters<typeof generateText>[0]['tools'];

const MAX_TOOL_ROUNDS = 3;

async function resolveToolFollowUp(
  tenant: TenantContext,
  textModel: TextModel,
  ragContext: string,
  userMessage: string,
  history: ChatTurn[],
  result: { text: string; finishReason?: string; toolResults?: Array<{ toolName: string; result: unknown }>; usage?: { promptTokens?: number; completionTokens?: number } },
  isFirstMessage: boolean,
  tools: ToolSet,
  conversationId?: string | null,
  round = 0,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const booking = result.toolResults?.find((r) => r.toolName === 'book_appointment');
  const availability = result.toolResults?.find((r) => r.toolName === 'check_availability');
  const reschedule = result.toolResults?.find((r) => r.toolName === 'reschedule_appointment');
  const cancel = result.toolResults?.find((r) => r.toolName === 'cancel_appointment');
  if (!booking && !availability && !reschedule && !cancel) {
    if (result.finishReason === 'error') {
      logger.warn({ tenantId: tenant.id, conversationId }, '[generate] model call finished with error');
    }
    return {
      text: stripRepeatedGreeting(result.text, isFirstMessage),
      inputTokens: result.usage?.promptTokens ?? 0,
      outputTokens: result.usage?.completionTokens ?? 0,
    };
  }

  let note: string;
  if (reschedule) {
    note = manageNote('reschedule', reschedule.result as RescheduleOutcome);
  } else if (cancel) {
    note = manageNote('cancel', cancel.result as CancelOutcome);
  } else if (booking) {
    const outcome = booking.result as BookingOutcome;
    note = outcome.ok
      ? `[System note: the appointment was successfully booked, from ${outcome.startAt} to ${outcome.endAt}. Confirm this to the client briefly, in their language, including the name, phone, service, date and time.]`
      : outcome.reason === 'slot_taken'
        ? `[System note: the requested time slot is already taken. Apologize briefly and ask the client for a different time, in their language.]`
        : outcome.reason === 'invalid_time'
          ? `[System note: the requested date/time could not be understood. Ask the client to restate the exact date and time, in their language.]`
          : `[System note: the booking could not be completed right now due to a technical problem. Apologize briefly and ask the client to try again in a few minutes. Do not mention any manager or manual confirmation. Reply in their language.]`;
  } else {
    const a = (availability as { result: unknown }).result as AvailabilityOutcome;
    note = a.ok
      ? `[System note: Google Calendar availability for ${a.date} (${a.timezone}). Busy: ${
          a.busy.length ? a.busy.map((b) => `${b.from}-${b.to}`).join(', ') : 'nothing'
        }. Free ${a.slotMinutes}-minute start times: ${
          a.freeStartTimes.length ? a.freeStartTimes.join(', ') : 'none'
        }. No appointment has been created yet, so never say that the appointment is booked at this point. If the time the client asked for is NOT in the free list, say it is taken and offer the 2-3 nearest free times from the list (or another day if nothing is free). If it IS free: if the client is moving an EXISTING appointment, call reschedule_appointment (never book_appointment); if it is a NEW appointment and the client has already given their name, phone number and the service, call book_appointment now; otherwise ask only for the missing details. Never invent times that are not in the list. Reply in the client's language.]`
      : a.reason === 'invalid_input'
        ? `[System note: the date could not be understood. Ask the client for the exact date, in their language.]`
        : `[System note: the calendar could not be read right now due to a technical problem. Apologize briefly and ask the client to try again in a few minutes. Do not mention any manager. Reply in their language.]`;
  }

  // Tools stay available only while we may still need a booking after an availability check.
  const slotTaken =
    (!!booking && (booking.result as BookingOutcome).ok === false && (booking.result as { reason?: string }).reason === 'slot_taken') ||
    (!!reschedule && (reschedule.result as RescheduleOutcome).ok === false && (reschedule.result as { reason?: string }).reason === 'slot_taken');
  const allowTools = round + 1 < MAX_TOOL_ROUNDS && (slotTaken || (!!availability && !booking && !reschedule && !cancel));
  const callFollowUp = () =>
    generateText({
      model: textModel.sdkModel,
      // The tool outcome goes into the system prompt (the model ignores it, and may even invent a success, when it
      // sits in a user turn). History stays as chat turns followed by ONE user turn: two consecutive user turns
      // after history make Gemini return an empty error response.
      messages: [
        {
          role: 'system',
          content:
            `${systemMessage(tenant, ragContext, isFirstMessage, true)}\n\n` +
            `=== RESULT OF THE ACTION YOU JUST PERFORMED FOR THE CLIENT'S LATEST MESSAGE (authoritative, already executed) ===\n${note}\n` +
            `Answer the client's latest message based ONLY on this result. Do not claim anything that this result does not say.` +
            (allowTools ? '' : ' No more tools are available now: reply to the client in plain text only (propose times, ask for missing details or ask for confirmation instead of calling a tool).'),
        },
        ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
        { role: 'user', content: userMessage },
      ] as CoreMessage[],
      tools: allowTools ? tools : undefined,
    });
  let followUp = await callFollowUp();
  if (!followUp.text.trim() && !followUp.toolResults?.length) {
    logger.warn({ tenantId: tenant.id, conversationId, finishReason: followUp.finishReason }, '[generate] empty follow-up, retrying once');
    followUp = await callFollowUp();
  }

  await logTextUsage({
    tenantId: tenant.id,
    provider: textModel.meta.provider,
    modelId: tenant.textModelId,
    inputTokens: followUp.usage?.promptTokens ?? 0,
    outputTokens: followUp.usage?.completionTokens ?? 0,
    conversationId,
  });

  const usedIn = (result.usage?.promptTokens ?? 0) + (followUp.usage?.promptTokens ?? 0);
  const usedOut = (result.usage?.completionTokens ?? 0) + (followUp.usage?.completionTokens ?? 0);

  if (followUp.toolResults?.length) {
    const next = await resolveToolFollowUp(
      tenant,
      textModel,
      ragContext,
      userMessage,
      history,
      followUp,
      isFirstMessage,
      tools,
      conversationId,
      round + 1,
    );
    return { text: next.text, inputTokens: usedIn + next.inputTokens, outputTokens: usedOut + next.outputTokens };
  }

  return {
    text: stripRepeatedGreeting(followUp.text, isFirstMessage),
    inputTokens: usedIn,
    outputTokens: usedOut,
  };
}

/**
 * Vision fallback: if the user sent an image and the tenant's text model has weak/no vision,
 * use the vision model to describe the image and append the description to the prompt.
 */
async function describeImage(
  tenant: TenantContext,
  imageBase64: string,
  mimeType: string,
  conversationId: string | null,
): Promise<string> {
  const { meta, sdkModel } = resolveVisionModel(tenant);
  const result = await generateText({
    model: sdkModel,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image briefly and extract any text/numbers visible. Reply in Russian.' },
          { type: 'image', image: imageBase64, mimeType },
        ],
      },
    ] as CoreMessage[],
  });
  await logVisionUsage({
    tenantId: tenant.id,
    provider: meta.provider,
    modelId: tenant.visionModelId,
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    conversationId,
  });
  return result.text;
}

export async function generateReply(args: GenerateReplyArgs): Promise<GenerateReplyResult> {
  const { tenant, history, userMessage, imageBase64, imageMimeType, conversationId, clientPhone } = args;

  // 1. RAG
  const ragContext = await queryCorpus(tenant, userMessage, conversationId);

  // Calendar tools (and the calendar prompt rules) only exist for tenants with a connected Google Calendar.
  const calendar =
    conversationId && clientPhone
      ? await prisma.tenantGoogleCalendar.findUnique({ where: { tenantId: tenant.id }, select: { status: true } })
      : null;
  const tools =
    conversationId && clientPhone && calendar?.status === 'connected'
      ? {
          book_appointment: bookAppointmentTool(tenant, conversationId),
          check_availability: checkAvailabilityTool(tenant),
          reschedule_appointment: rescheduleAppointmentTool(tenant, conversationId),
          cancel_appointment: cancelAppointmentTool(tenant, conversationId),
        }
      : undefined;

  // 2. Vision fallback (if image and text model can't handle vision natively)
  let augmentedUserMessage = userMessage;
  const textModel = resolveTextModel(tenant);
  if (imageBase64 && imageMimeType) {
    if (textModel.meta.supportsVision) {
      // Send image directly to text model
      const messages: CoreMessage[] = [
        { role: 'system', content: systemMessage(tenant, ragContext, history.length === 0, !!tools) },
        ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content: [
            { type: 'text', text: userMessage },
            { type: 'image', image: imageBase64, mimeType: imageMimeType },
          ],
        },
      ];
      const result = await generateText({ model: textModel.sdkModel, messages, tools });
      await logTextUsage({
        tenantId: tenant.id,
        provider: textModel.meta.provider,
        modelId: tenant.textModelId,
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
        conversationId,
      });
      const final = await resolveToolFollowUp(tenant, textModel, ragContext, userMessage, history, result, history.length === 0, tools, conversationId);
      return { ...final, ragUsed: !!ragContext };
    }
    // Fallback: describe via vision model and append
    const desc = await describeImage(tenant, imageBase64, imageMimeType, conversationId ?? null);
    augmentedUserMessage = `${userMessage}\n\n[Image description from vision model: ${desc}]`;
  }

  const messages: CoreMessage[] = [
    { role: 'system', content: systemMessage(tenant, ragContext, history.length === 0, !!tools) },
    ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: augmentedUserMessage },
  ];
  const result = await generateText({ model: textModel.sdkModel, messages, tools });

  await logTextUsage({
    tenantId: tenant.id,
    provider: textModel.meta.provider,
    modelId: tenant.textModelId,
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    conversationId,
  });

  const final = await resolveToolFollowUp(tenant, textModel, ragContext, userMessage, history, result, history.length === 0, tools, conversationId);
  return { ...final, ragUsed: !!ragContext };
}
