import { generateText, type CoreMessage } from 'ai';
import { resolveTextModel, resolveVisionModel } from './providers.js';
import { logTextUsage, logVisionUsage } from './usageLog.js';
import { queryCorpus } from './rag.js';
import type { TenantContext } from '../tenantContext.js';
import { buildPhotoTool, photoPromptSection } from '../photos/tool.js';
import { listPhotoSummary } from '../photos/store.js';
import { MAX_CATEGORIES_PER_REPLY, type PhotoCategoryId } from '../photos/categories.js';

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
  const system = () => systemMessage(tenant, ragContext, history.length === 0) + photoPrompt;

  const run = async (messages: CoreMessage[]) => {
    const result = await generateText({
      model: textModel.sdkModel,
      messages,
      ...(photo ? { tools: { send_photos: photo.tool }, maxSteps: 3 } : {}),
    });
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
    return {
      text: raw.trim() || (queued.length ? FALLBACK_PHOTO_TEXT : raw),
      inputTokens,
      outputTokens,
      ragUsed: !!ragContext,
      photoCategories: queued,
      photoBlocked: photo?.state.blocked ?? false,
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
