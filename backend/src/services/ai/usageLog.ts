import { prisma } from '../../prisma.js';
import { calcTextCost, calcSttCost } from '../../config/model-pricing.js';

export async function logTextUsage(args: {
  tenantId: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  conversationId?: string | null;
}): Promise<void> {
  const cost = calcTextCost(args.modelId, args.inputTokens, args.outputTokens);
  await prisma.aiUsageLog.create({
    data: {
      tenantId: args.tenantId,
      category: 'text',
      provider: args.provider,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedCostUsd: cost,
      conversationId: args.conversationId ?? null,
    },
  });
}

export async function logVisionUsage(args: {
  tenantId: string;
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  conversationId?: string | null;
}): Promise<void> {
  const cost = calcTextCost(args.modelId, args.inputTokens, args.outputTokens);
  await prisma.aiUsageLog.create({
    data: {
      tenantId: args.tenantId,
      category: 'vision',
      provider: args.provider,
      modelId: args.modelId,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      estimatedCostUsd: cost,
      conversationId: args.conversationId ?? null,
    },
  });
}

export async function logSttUsage(args: {
  tenantId: string;
  provider: string;
  modelId: string;
  durationSeconds: number;
  conversationId?: string | null;
}): Promise<void> {
  const cost = calcSttCost(args.modelId, args.durationSeconds);
  await prisma.aiUsageLog.create({
    data: {
      tenantId: args.tenantId,
      category: 'stt',
      provider: args.provider,
      modelId: args.modelId,
      durationSeconds: args.durationSeconds,
      estimatedCostUsd: cost,
      conversationId: args.conversationId ?? null,
    },
  });
}

export async function logRagUsage(args: {
  tenantId: string;
  inputTokens: number;
  conversationId?: string | null;
}): Promise<void> {
  // Gemini File Search query embedding cost (~$0.15 / 1M tokens at writing)
  const cost = (args.inputTokens / 1_000_000) * 0.15;
  await prisma.aiUsageLog.create({
    data: {
      tenantId: args.tenantId,
      category: 'rag',
      provider: 'google',
      modelId: 'file-search',
      inputTokens: args.inputTokens,
      outputTokens: 0,
      estimatedCostUsd: cost,
      conversationId: args.conversationId ?? null,
    },
  });
}
