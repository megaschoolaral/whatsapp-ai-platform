import { transcribeWithElevenLabs } from './elevenlabs.js';
import { transcribeWithSoniox } from './soniox.js';
import type { TenantContext } from '../tenantContext.js';

export async function transcribe(
  tenant: TenantContext,
  audio: Buffer,
  mimeType: string,
  conversationId: string | null,
): Promise<string> {
  if (tenant.sttModelId === 'soniox') {
    return transcribeWithSoniox(tenant, audio, mimeType, conversationId);
  }
  return transcribeWithElevenLabs(tenant, audio, mimeType, conversationId);
}
