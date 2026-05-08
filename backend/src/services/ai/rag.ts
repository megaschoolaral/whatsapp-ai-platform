import { request } from 'undici';
import { GoogleGenAI } from '@google/genai';
import { logger } from '../../logger.js';
import { logRagUsage } from './usageLog.js';
import type { TenantContext } from '../tenantContext.js';

/**
 * Gemini File Search Store integration via raw HTTP for full error visibility.
 *
 * Endpoints (Gemini Developer API, v1beta):
 *   - Create store:    POST  /v1beta/fileSearchStores
 *   - Upload + import: POST  /upload/v1beta/{store_name}:uploadToFileSearchStore  (resumable)
 *   - Delete document: DELETE /v1beta/{document_name}
 *
 * Docs: https://ai.google.dev/gemini-api/docs/file-search
 */

const BASE = 'https://generativelanguage.googleapis.com';

function authHeaders(tenant: TenantContext, extra: Record<string, string> = {}): Record<string, string> {
  if (!tenant.apiKeys.gemini) throw new Error('Gemini key required');
  return { 'x-goog-api-key': tenant.apiKeys.gemini, ...extra };
}

async function readBody(body: { text(): Promise<string> }): Promise<string> {
  try {
    return await body.text();
  } catch {
    return '';
  }
}

class GeminiHttpError extends Error {
  status: number;
  url: string;
  body: string;
  constructor(url: string, status: number, body: string) {
    super(`Gemini API ${status} on ${url}: ${body || '(empty body)'}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}

/** Ensure a FileSearchStore exists for the tenant. Returns the store resource name. */
export async function ensureCorpus(tenant: TenantContext): Promise<string> {
  // Reuse only if already in the new "fileSearchStores/..." format.
  if (tenant.apiKeys.geminiCorpusId?.startsWith('fileSearchStores/')) {
    return tenant.apiKeys.geminiCorpusId;
  }

  const url = `${BASE}/v1beta/fileSearchStores`;
  const res = await request(url, {
    method: 'POST',
    headers: { ...authHeaders(tenant), 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: `tenant-${tenant.id}` }),
  });
  const text = await readBody(res.body);
  if (res.statusCode >= 300) {
    logger.error({ url, status: res.statusCode, body: text }, '[rag] ensureCorpus failed');
    throw new GeminiHttpError(url, res.statusCode, text);
  }
  const json = JSON.parse(text) as { name?: string };
  if (!json.name) throw new Error(`fileSearchStores.create returned no name: ${text}`);
  logger.info({ name: json.name, tenantId: tenant.id }, '[rag] FileSearchStore created');
  return json.name;
}

export interface UploadResult {
  fileId: string;       // long-running operation name
  storeName: string;
}

/**
 * Upload a file via the resumable upload protocol and import it into the
 * tenant's File Search Store. This is a two-step protocol:
 *   1. POST start request → receive X-Goog-Upload-URL
 *   2. POST file bytes to that URL with X-Goog-Upload-Command: upload, finalize
 */
export async function uploadFileToCorpus(
  tenant: TenantContext,
  storeName: string,
  filename: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<UploadResult> {
  const startUrl = `${BASE}/upload/v1beta/${storeName}:uploadToFileSearchStore`;
  const startRes = await request(startUrl, {
    method: 'POST',
    headers: {
      ...authHeaders(tenant, {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(fileBuffer.byteLength),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'content-type': 'application/json',
      }),
    },
    body: JSON.stringify({ display_name: filename, mime_type: mimeType }),
  });
  if (startRes.statusCode >= 300) {
    const text = await readBody(startRes.body);
    logger.error(
      { url: startUrl, status: startRes.statusCode, body: text, storeName },
      '[rag] resumable start failed',
    );
    throw new GeminiHttpError(startUrl, startRes.statusCode, text);
  }
  // Drain start response
  await readBody(startRes.body);
  const uploadUrl =
    (startRes.headers['x-goog-upload-url'] as string | undefined) ??
    (startRes.headers['X-Goog-Upload-URL'] as string | undefined);
  if (!uploadUrl) {
    throw new Error(`Resumable upload start: missing X-Goog-Upload-URL header. Headers: ${JSON.stringify(startRes.headers)}`);
  }

  // Step 2: send the bytes
  const uploadRes = await request(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(fileBuffer.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: fileBuffer,
  });
  const uploadText = await readBody(uploadRes.body);
  if (uploadRes.statusCode >= 300) {
    logger.error(
      { url: uploadUrl, status: uploadRes.statusCode, body: uploadText },
      '[rag] resumable finalize failed',
    );
    throw new GeminiHttpError(uploadUrl, uploadRes.statusCode, uploadText);
  }
  // Response is a long-running operation
  const op = JSON.parse(uploadText) as { name?: string; metadata?: { documentName?: string } };
  const id = op.name ?? op.metadata?.documentName;
  if (!id) throw new Error(`uploadToFileSearchStore returned no name: ${uploadText}`);
  logger.info({ id, tenantId: tenant.id }, '[rag] file uploaded, indexing started');
  return { fileId: id, storeName };
}

export async function deleteFile(tenant: TenantContext, fileResourceName: string): Promise<void> {
  // documents are addressed by their full resource name
  const url = `${BASE}/v1beta/${fileResourceName}`;
  const res = await request(url, { method: 'DELETE', headers: authHeaders(tenant) });
  if (res.statusCode >= 300 && res.statusCode !== 404) {
    const body = await readBody(res.body);
    logger.warn({ url, status: res.statusCode, body }, '[rag] deleteFile failed');
  } else {
    await readBody(res.body);
  }
}

/**
 * Run Gemini grounded generation against the tenant's FileSearchStore and
 * return the synthesized retrieval context. Used by generate.ts when the
 * tenant's main text model isn't Gemini (e.g. Grok/OpenAI) so that we can
 * pipe File Search results into any provider.
 */
export async function queryCorpus(
  tenant: TenantContext,
  query: string,
  conversationId?: string | null,
): Promise<string> {
  if (!tenant.apiKeys.geminiCorpusId || !tenant.apiKeys.gemini) return '';
  try {
    const ai = new GoogleGenAI({ apiKey: tenant.apiKeys.gemini });
    const result = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: query,
      config: {
        tools: [{ fileSearch: { fileSearchStoreNames: [tenant.apiKeys.geminiCorpusId] } }],
        systemInstruction:
          'You are a retrieval helper. Reply with relevant facts from the knowledge base only, ' +
          'no commentary. If nothing relevant, reply with the empty string.',
      },
    });
    const text = result.text ?? '';
    await logRagUsage({
      tenantId: tenant.id,
      inputTokens: Math.ceil(query.length / 4),
      conversationId: conversationId ?? null,
    });
    return text;
  } catch (err) {
    logger.warn({ err }, '[rag] queryCorpus failed');
    return '';
  }
}
