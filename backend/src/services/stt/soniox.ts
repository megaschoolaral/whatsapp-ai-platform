import { request } from 'undici';
import FormData from 'form-data';
import { logSttUsage } from '../ai/usageLog.js';
import { getSttModel } from '../../config/model-pricing.js';
import type { TenantContext } from '../tenantContext.js';

const API = 'https://api.soniox.com/v1';
const POLL_INTERVAL_MS = 1000;
const TIMEOUT_MS = 90_000;

type Auth = { authorization: string };

async function sonioxJson<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  auth: Auth,
  body?: unknown,
): Promise<T | null> {
  const res = await request(`${API}${path}`, {
    method,
    headers: { ...auth, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.body.text();
  if (res.statusCode >= 300) {
    throw new Error(`Soniox ${method} ${path} failed: ${res.statusCode} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : null;
}

/**
 * Soniox async transcription: upload file → create transcription → poll → fetch transcript.
 * Uploaded file and transcription are deleted afterwards (best-effort).
 */
export async function transcribeWithSoniox(
  tenant: TenantContext,
  audio: Buffer,
  mimeType: string,
  conversationId: string | null,
): Promise<string> {
  if (!tenant.apiKeys.soniox) throw new Error('Soniox key not configured');
  const auth: Auth = { authorization: `Bearer ${tenant.apiKeys.soniox}` };
  const model = getSttModel('soniox')?.modelId ?? 'stt-async-v5';

  const form = new FormData();
  form.append('file', audio, { filename: 'audio.ogg', contentType: mimeType });
  const upload = await request(`${API}/files`, {
    method: 'POST',
    headers: { ...form.getHeaders(), ...auth },
    body: form.getBuffer(),
  });
  const uploadText = await upload.body.text();
  if (upload.statusCode >= 300) {
    throw new Error(`Soniox file upload failed: ${upload.statusCode} ${uploadText}`);
  }
  const fileId = (JSON.parse(uploadText) as { id: string }).id;

  let transcriptionId: string | null = null;
  try {
    const created = await sonioxJson<{ id: string }>('POST', '/transcriptions', auth, {
      model,
      file_id: fileId,
      language_hints: ['kk', 'ru', 'en'],
    });
    transcriptionId = created!.id;

    const deadline = Date.now() + TIMEOUT_MS;
    let durationMs = 0;
    for (;;) {
      const info = await sonioxJson<{ status: string; error_message?: string | null; audio_duration_ms?: number | null }>(
        'GET',
        `/transcriptions/${transcriptionId}`,
        auth,
      );
      if (info?.status === 'completed') {
        durationMs = info.audio_duration_ms ?? 0;
        break;
      }
      if (info?.status === 'error') {
        throw new Error(`Soniox transcription error: ${info.error_message ?? 'unknown'}`);
      }
      if (Date.now() > deadline) throw new Error('Soniox transcription timed out');
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    const transcript = await sonioxJson<{ text?: string }>('GET', `/transcriptions/${transcriptionId}/transcript`, auth);

    await logSttUsage({
      tenantId: tenant.id,
      provider: 'soniox',
      modelId: 'soniox',
      durationSeconds: durationMs > 0 ? durationMs / 1000 : Math.max(1, audio.byteLength / 16_000),
      conversationId,
    });
    return transcript?.text ?? '';
  } finally {
    if (transcriptionId) await sonioxJson('DELETE', `/transcriptions/${transcriptionId}`, auth).catch(() => undefined);
    await sonioxJson('DELETE', `/files/${fileId}`, auth).catch(() => undefined);
  }
}
