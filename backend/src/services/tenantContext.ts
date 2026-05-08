import { prisma } from '../prisma.js';
import { decrypt } from '../crypto/aesGcm.js';

export interface TenantContext {
  id: string;
  name: string;
  status: string;
  aiPersona: string;
  timezone: string;
  warmupStartedAt: Date | null;
  textModelId: string;
  visionModelId: string;
  sttModelId: string;
  apiKeys: {
    openai: string | null;
    gemini: string | null;
    xai: string | null;
    elevenlabs: string | null;
    soniox: string | null;
    geminiCorpusId: string | null;
  };
}

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

export async function loadTenantContext(tenantId: string): Promise<TenantContext | null> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { apiKeys: true, modelChoices: true },
  });
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    status: t.status,
    aiPersona: t.aiPersona,
    timezone: t.timezone,
    warmupStartedAt: t.warmupStartedAt,
    textModelId: t.modelChoices?.textModelId ?? 'gemini-3-flash',
    visionModelId: t.modelChoices?.visionModelId ?? 'gemini-3-flash',
    sttModelId: t.modelChoices?.sttModelId ?? 'elevenlabs-scribe-v2',
    apiKeys: {
      openai: safeDecrypt(t.apiKeys?.openaiKey),
      gemini: safeDecrypt(t.apiKeys?.geminiKey),
      xai: safeDecrypt(t.apiKeys?.xaiKey),
      elevenlabs: safeDecrypt(t.apiKeys?.elevenlabsKey),
      soniox: safeDecrypt(t.apiKeys?.sonioxKey),
      geminiCorpusId: t.apiKeys?.geminiCorpusId ?? null,
    },
  };
}
