import { generateText, type CoreMessage } from 'ai';
import { resolveTextModel, resolveVisionModel } from './providers.js';
import { logTextUsage, logVisionUsage } from './usageLog.js';
import { queryCorpus } from './rag.js';
import { bookAppointmentTool } from './tools/bookAppointment.js';
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

function systemMessage(tenant: TenantContext, ragContext: string, isFirstMessage: boolean): string {
  const now = new Date().toLocaleString('ru-RU', { timeZone: tenant.timezone });
  let sys = tenant.aiPersona || 'You are a helpful assistant for a small business.';
  sys += `\n\nCurrent time: ${now}\nTimezone: ${tenant.timezone}`;
  sys += `\n\nIMPORTANT RULE: Never ask the client questions. Only answer what they ask. If the client's message is unclear, give the most helpful answer you can based on what you know — do not ask clarifying questions back.`;
  sys += `\n\nYou can book appointments directly using the book_appointment tool once the client has confirmed a specific date and time. Every appointment is exactly 60 minutes. If the tool says the slot is taken, suggest a different time instead of retrying the same slot.`;
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
  | { ok: false; reason: 'not_connected' | 'invalid_time' | 'slot_taken' };

interface TextModel {
  meta: { provider: string; supportsVision: boolean };
  sdkModel: Parameters<typeof generateText>[0]['model'];
}

/**
 * If the model called book_appointment, the AI SDK's built-in multi-step continuation
 * (re-sending the assistant's functionCall turn) fails against Gemini 3 models with
 * "missing a thought_signature" — a gap in this SDK version's Gemini-3 support. Instead
 * of relying on that continuation, we do our own plain-text follow-up call: no functionCall/
 * functionResponse parts involved, so the thought_signature requirement never applies.
 */
async function resolveBookingFollowUp(
  tenant: TenantContext,
  textModel: TextModel,
  ragContext: string,
  userMessage: string,
  result: { text: string; toolResults?: Array<{ toolName: string; result: unknown }>; usage?: { promptTokens?: number; completionTokens?: number } },
  isFirstMessage: boolean,
  conversationId?: string | null,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const booking = result.toolResults?.find((r) => r.toolName === 'book_appointment');
  if (!booking) {
    return {
      text: stripRepeatedGreeting(result.text, isFirstMessage),
      inputTokens: result.usage?.promptTokens ?? 0,
      outputTokens: result.usage?.completionTokens ?? 0,
    };
  }

  const outcome = booking.result as BookingOutcome;
  const note = outcome.ok
    ? `[System note: the appointment was successfully booked, from ${outcome.startAt} to ${outcome.endAt}. Confirm this to the client briefly, in their language.]`
    : outcome.reason === 'slot_taken'
      ? `[System note: the requested time slot is already taken. Apologize briefly and ask the client for a different time, in their language.]`
      : `[System note: the calendar booking system is currently unavailable. Apologize briefly and tell the client someone will confirm manually, in their language.]`;

  const followUp = await generateText({
    model: textModel.sdkModel,
    messages: [
      { role: 'system', content: systemMessage(tenant, ragContext, isFirstMessage) },
      { role: 'user', content: userMessage },
      { role: 'user', content: note },
    ] as CoreMessage[],
  });

  await logTextUsage({
    tenantId: tenant.id,
    provider: textModel.meta.provider,
    modelId: tenant.textModelId,
    inputTokens: followUp.usage?.promptTokens ?? 0,
    outputTokens: followUp.usage?.completionTokens ?? 0,
    conversationId,
  });

  return {
    text: stripRepeatedGreeting(followUp.text, isFirstMessage),
    inputTokens: (result.usage?.promptTokens ?? 0) + (followUp.usage?.promptTokens ?? 0),
    outputTokens: (result.usage?.completionTokens ?? 0) + (followUp.usage?.completionTokens ?? 0),
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

  const tools =
    conversationId && clientPhone
      ? { book_appointment: bookAppointmentTool(tenant, conversationId, clientPhone) }
      : undefined;

  // 2. Vision fallback (if image and text model can't handle vision natively)
  let augmentedUserMessage = userMessage;
  const textModel = resolveTextModel(tenant);
  if (imageBase64 && imageMimeType) {
    if (textModel.meta.supportsVision) {
      // Send image directly to text model
      const messages: CoreMessage[] = [
        { role: 'system', content: systemMessage(tenant, ragContext, history.length === 0) },
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
      const final = await resolveBookingFollowUp(tenant, textModel, ragContext, userMessage, result, history.length === 0, conversationId);
      return { ...final, ragUsed: !!ragContext };
    }
    // Fallback: describe via vision model and append
    const desc = await describeImage(tenant, imageBase64, imageMimeType, conversationId ?? null);
    augmentedUserMessage = `${userMessage}\n\n[Image description from vision model: ${desc}]`;
  }

  const messages: CoreMessage[] = [
    { role: 'system', content: systemMessage(tenant, ragContext, history.length === 0) },
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

  const final = await resolveBookingFollowUp(tenant, textModel, ragContext, userMessage, result, history.length === 0, conversationId);
  return { ...final, ragUsed: !!ragContext };
}
