import { generateText, type CoreMessage } from 'ai';
import { resolveTextModel, resolveVisionModel } from './providers.js';
import { logTextUsage, logVisionUsage } from './usageLog.js';
import { queryCorpus } from './rag.js';
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
}

export interface GenerateReplyResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  ragUsed: boolean;
}

function systemMessage(tenant: TenantContext, ragContext: string): string {
  const now = new Date().toLocaleString('ru-RU', { timeZone: tenant.timezone });
  let sys = tenant.aiPersona || 'You are a helpful assistant for a small business.';
  sys += `\n\nCurrent time: ${now}\nTimezone: ${tenant.timezone}`;
  if (ragContext) {
    sys += `\n\nRelevant info from knowledge base (use only if relevant):\n${ragContext}`;
  }
  return sys;
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
  const { tenant, history, userMessage, imageBase64, imageMimeType, conversationId } = args;

  // 1. RAG
  const ragContext = await queryCorpus(tenant, userMessage, conversationId);

  // 2. Vision fallback (if image and text model can't handle vision natively)
  let augmentedUserMessage = userMessage;
  const textModel = resolveTextModel(tenant);
  if (imageBase64 && imageMimeType) {
    if (textModel.meta.supportsVision) {
      // Send image directly to text model
      const messages: CoreMessage[] = [
        { role: 'system', content: systemMessage(tenant, ragContext) },
        ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
        {
          role: 'user',
          content: [
            { type: 'text', text: userMessage },
            { type: 'image', image: imageBase64, mimeType: imageMimeType },
          ],
        },
      ];
      const result = await generateText({ model: textModel.sdkModel, messages });
      await logTextUsage({
        tenantId: tenant.id,
        provider: textModel.meta.provider,
        modelId: tenant.textModelId,
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
        conversationId,
      });
      return {
        text: result.text,
        inputTokens: result.usage?.promptTokens ?? 0,
        outputTokens: result.usage?.completionTokens ?? 0,
        ragUsed: !!ragContext,
      };
    }
    // Fallback: describe via vision model and append
    const desc = await describeImage(tenant, imageBase64, imageMimeType, conversationId ?? null);
    augmentedUserMessage = `${userMessage}\n\n[Image description from vision model: ${desc}]`;
  }

  const messages: CoreMessage[] = [
    { role: 'system', content: systemMessage(tenant, ragContext) },
    ...history.map<CoreMessage>((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: augmentedUserMessage },
  ];
  const result = await generateText({ model: textModel.sdkModel, messages });

  await logTextUsage({
    tenantId: tenant.id,
    provider: textModel.meta.provider,
    modelId: tenant.textModelId,
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    conversationId,
  });

  return {
    text: result.text,
    inputTokens: result.usage?.promptTokens ?? 0,
    outputTokens: result.usage?.completionTokens ?? 0,
    ragUsed: !!ragContext,
  };
}
