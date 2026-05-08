import { request } from 'undici';
import { logSttUsage } from '../ai/usageLog.js';
import type { TenantContext } from '../tenantContext.js';

/**
 * Soniox async transcription (simplified single-call flow).
 */
export async function transcribeWithSoniox(
  tenant: TenantContext,
  audio: Buffer,
  _mimeType: string,
  conversationId: string | null,
): Promise<string> {
  if (!tenant.apiKeys.soniox) throw new Error('Soniox key not configured');

  const res = await request('https://api.soniox.com/transcribe-async/v1/transcribe', {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      authorization: `Bearer ${tenant.apiKeys.soniox}`,
      'x-soniox-language-hints': 'kk,ru,en',
    },
    body: audio,
  });
  if (res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`Soniox STT failed: ${res.statusCode} ${text}`);
  }
  const json = (await res.body.json()) as { text?: string; transcript?: string };
  const transcript = json.text ?? json.transcript ?? '';

  const durationSeconds = Math.max(1, audio.byteLength / 16_000);
  await logSttUsage({
    tenantId: tenant.id,
    provider: 'soniox',
    modelId: 'soniox',
    durationSeconds,
    conversationId,
  });
  return transcript;
}
