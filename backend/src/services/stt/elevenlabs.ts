import { request } from 'undici';
import FormData from 'form-data';
import { logSttUsage } from '../ai/usageLog.js';
import type { TenantContext } from '../tenantContext.js';

export async function transcribeWithElevenLabs(
  tenant: TenantContext,
  audio: Buffer,
  mimeType: string,
  conversationId: string | null,
): Promise<string> {
  if (!tenant.apiKeys.elevenlabs) throw new Error('ElevenLabs key not configured');
  const form = new FormData();
  form.append('file', audio, { filename: 'audio.ogg', contentType: mimeType });
  form.append('model_id', 'scribe_v2');

  const res = await request('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { ...form.getHeaders(), 'xi-api-key': tenant.apiKeys.elevenlabs },
    body: form.getBuffer(),
  });
  if (res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`ElevenLabs STT failed: ${res.statusCode} ${text}`);
  }
  const json = (await res.body.json()) as { text?: string };

  // Best-effort duration estimate: caller can override with real ffprobe if available.
  const durationSeconds = Math.max(1, audio.byteLength / 16_000);
  await logSttUsage({
    tenantId: tenant.id,
    provider: 'elevenlabs',
    modelId: 'elevenlabs-scribe-v2',
    durationSeconds,
    conversationId,
  });
  return json.text ?? '';
}
