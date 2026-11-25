import { generateText, type CoreMessage } from 'ai';
import { resolveTextModel, resolveVisionModel } from './providers.js';
import { logTextUsage, logVisionUsage } from './usageLog.js';
import { queryCorpus } from './rag.js';
import type { TenantContext } from '../tenantContext.js';
import { buildPhotoTool, photoPromptSection } from '../photos/tool.js';
import { listPhotoSummary } from '../photos/store.js';
import { MAX_CATEGORIES_PER_REPLY, type PhotoCategoryId } from '../photos/categories.js';
import { logger } from '../../logger.js';
import { getSheetsSettings } from '../sheets/settings.js';
import { readSlots } from '../sheets/read.js';
import { upcomingFreeSlots } from '../sheets/schedule.js';
import { detectLang } from '../sheets/language.js';
import {
  buildSheetsTool,
  bookedReply,
  conflictReply,
  failedReply,
  needDetailsReply,
  sheetsPromptSection,
  sheetsUnavailablePrompt,
} from '../sheets/tool.js';

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
}

export interface GenerateReplyResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  ragUsed: boolean;
  /** Photo categories the AI asked to send after the text reply. */
  photoCategories: PhotoCategoryId[];
  /** The AI wanted to send photos but the anti-ban limits could not fit them: a human should follow up. */
  photoBlocked: boolean;
  /** The AI booked a slot in the tenant's Google Sheet. */
  sheetsBooked: boolean;
  /** Sheets could not be read or written: a human should follow up. */
  sheetsFailed: boolean;
}

function systemMessage(tenant: TenantContext, ragContext: string, isFirstMessage: boolean): string {
  const now = new Date().toLocaleString('ru-RU', { timeZone: tenant.timezone });
  let sys = tenant.aiPersona || 'You are a helpful assistant for a small business.';
  sys += `\n\nCurrent time: ${now}\nTimezone: ${tenant.timezone}`;
  sys += `\n\nIMPORTANT RULE: Never ask the client questions. Only answer what they ask. If the client's message is unclear, give the most helpful answer you can based on what you know — do not ask clarifying questions back.`;
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

const FALLBACK_PHOTO_TEXT = 'Фото отправляю.';

export async function generateReply(args: GenerateReplyArgs): Promise<GenerateReplyResult> {
  const { tenant, history, userMessage, imageBase64, imageMimeType, conversationId } = args;

  // 1. RAG
  const ragContext = await queryCorpus(tenant, userMessage, conversationId);

  const textModel = resolveTextModel(tenant);
  const lang = detectLang([...history.filter((h) => h.role === 'user').slice(-3).map((h) => h.content), userMessage]);

  // Photo tool: only when the tenant uploaded photos and the model can call tools.
  let photo: ReturnType<typeof buildPhotoTool> | null = null;
  let photoPrompt = '';
  if (conversationId && textModel.meta.supportsTools) {
    const categories = (await listPhotoSummary(tenant.id))
      .map((c) => ({ id: c.id, label: c.label, count: c.photos.length }))
      .filter((c) => c.count > 0);
    if (categories.length) {
      photo = buildPhotoTool({ tenantId: tenant.id, conversationId });
      photoPrompt = photoPromptSection(categories);
    }
  }

  // Sheets booking: only when the tenant switched it on and the model can call tools.
  let sheets: ReturnType<typeof buildSheetsTool> | null = null;
  let sheetsPrompt = '';
  if (conversationId && textModel.meta.supportsTools) {
    const settings = await getSheetsSettings(tenant.id);
    if (settings.enabled) {
      try {
        const free = upcomingFreeSlots(await readSlots(tenant.id), new Date(), tenant.timezone, settings.daysAhead);
        sheets = buildSheetsTool({ tenantId: tenant.id, conversationId, lang });
        sheetsPrompt = sheetsPromptSection(free);
      } catch (err) {
        logger.error({ err, tenantId: tenant.id }, 'sheets: could not read the schedule');
        sheetsPrompt = sheetsUnavailablePrompt();
      }
    }
  }
  const system = () => systemMessage(tenant, ragContext, history.length === 0) + photoPrompt + sheetsPrompt;

  // Gemini 3 rejects the follow-up step (400 "missing a thought_signature"): the SDK does not echo the signature back.
  // So on Google the tool call ends the turn; the text written next to it (or the fallback) is the reply.
  const maxSteps = textModel.meta.provider === 'google' ? 1 : 3;

  const run = async (messages: CoreMessage[]) => {
    let result: Awaited<ReturnType<typeof generateText>>;
    try {
      result = await generateText({
        model: textModel.sdkModel,
        messages,
        ...(photo || sheets
          ? {
              tools: { ...(photo ? { send_photos: photo.tool } : {}), ...(sheets ? { book_slot: sheets.tool } : {}) },
              maxSteps,
            }
          : {}),
      });
    } catch (err) {
      // The row is already written: the client must still hear about it instead of the turn being retried.
      if (!sheets?.state.booked) throw err;
      logger.error({ err, tenantId: tenant.id }, 'sheets: model call failed after a booking was written');
      result = { text: '', usage: undefined } as unknown as typeof result;
    }
    const inputTokens = result.usage?.promptTokens ?? 0;
    const outputTokens = result.usage?.completionTokens ?? 0;
    await logTextUsage({
      tenantId: tenant.id,
      provider: textModel.meta.provider,
      modelId: tenant.textModelId,
      inputTokens,
      outputTokens,
      conversationId,
    });
    const queued = photo ? [...new Set(photo.queued)].slice(0, MAX_CATEGORIES_PER_REPLY) : [];
    const raw = stripRepeatedGreeting(result.text, history.length === 0);
    let text = raw.trim() || (queued.length ? FALLBACK_PHOTO_TEXT : raw);
    // The model writes its text before it sees the tool result (always on Google), so the text must never claim a booking that did not happen.
    const ownText = !text.trim() || textModel.meta.provider === 'google';
    if (sheets?.state.failed) {
      text = failedReply(lang);
    } else if (sheets?.state.booked && sheets.state.lastBooking && ownText) {
      text = bookedReply(sheets.state.lastBooking, lang);
    } else if (sheets?.state.missingDetails && !sheets.state.booked && !sheets.state.conflict && ownText) {
      text = needDetailsReply(lang);
    } else if (sheets?.state.conflict && !sheets.state.booked) {
      try {
        const free = upcomingFreeSlots(await readSlots(tenant.id, { fresh: true }), new Date(), tenant.timezone, 7);
        text = conflictReply(free, lang);
      } catch {
        text = failedReply(lang);
        sheets.state.failed = true;
      }
    }
    return {
      text,
      inputTokens,
      outputTokens,
      ragUsed: !!ragContext,
      photoCategories: queued,
      photoBlocked: photo?.state.blocked ?? false,
      sheetsBooked: sheets?.state.booked ?? false,
      sheetsFailed: sheets?.state.failed ?? false,
    };
  };

  // 2. Vision fallback (if image and text model can't handle vision natively)
  let augmentedUserMessage = userMessage;
  if (imageBase64 && imageMimeType) {
    if (textModel.meta.supportsVision) {
      // Send image directly to text model
      return run([
        { role: 'system', content: system() },
        ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content: [
            { type: 'text', text: userMessage },
            { type: 'image', image: imageBase64, mimeType: imageMimeType },
          ],
        },
      ]);
    }
    // Fallback: describe via vision model and append
    const desc = await describeImage(tenant, imageBase64, imageMimeType, conversationId ?? null);
    augmentedUserMessage = `${userMessage}\n\n[Image description from vision model: ${desc}]`;
  }

  return run([
    { role: 'system', content: system() },
    ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: augmentedUserMessage },
  ]);
}
