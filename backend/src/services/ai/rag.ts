import { GoogleGenAI } from '@google/genai';
import { logger } from '../../logger.js';
import { logRagUsage } from './usageLog.js';
import type { TenantContext } from '../tenantContext.js';

/**
 * Gemini File Search Store integration.
 *
 * Per the current Gemini File Search API (Nov 2025+):
 *  - Each tenant has a single FileSearchStore: "fileSearchStores/<id>"
 *  - Files are uploaded into it via uploadToFileSearchStore (long-running op)
 *  - To use it in generation, attach a `fileSearch` tool that references the
 *    store; the model performs retrieval automatically and returns citations
 *    in groundingMetadata.
 *
 * Docs: https://ai.google.dev/gemini-api/docs/file-search
 */

function client(tenant: TenantContext): GoogleGenAI {
  if (!tenant.apiKeys.gemini) throw new Error('Gemini key required');
  return new GoogleGenAI({ apiKey: tenant.apiKeys.gemini });
}

/** Ensure a FileSearchStore exists for the tenant. Returns the store resource name. */
export async function ensureCorpus(tenant: TenantContext): Promise<string> {
  // Reuse only if already in the new "fileSearchStores/..." format.
  // Old "corpora/..." ids point to the deprecated Semantic Retrieval API and
  // will cause 404s — drop them and create a fresh store.
  if (tenant.apiKeys.geminiCorpusId?.startsWith('fileSearchStores/')) {
    return tenant.apiKeys.geminiCorpusId;
  }
  const ai = client(tenant);
  const store = await ai.fileSearchStores.create({
    config: { displayName: `tenant-${tenant.id}` },
  });
  if (!store.name) throw new Error('FileSearchStore created without a name');
  return store.name;
}

export interface UploadResult {
  fileId: string;       // operation name to track indexing
  storeName: string;
}

/**
 * Upload a file to the tenant's FileSearchStore.
 * Triggers a long-running indexing operation; the file is queryable once it
 * completes (state = ACTIVE). UI can poll via getOperation if needed.
 */
export async function uploadFileToCorpus(
  tenant: TenantContext,
  storeName: string,
  filename: string,
  fileBuffer: Buffer,
  mimeType: string,
): Promise<UploadResult> {
  const ai = client(tenant);
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
  const op = await ai.fileSearchStores.uploadToFileSearchStore({
    fileSearchStoreName: storeName,
    file: blob,
    config: { displayName: filename, mimeType },
  });
  const id =
    (op as { name?: string }).name ??
    ((op as { metadata?: { documentName?: string } }).metadata?.documentName ?? null);
  if (!id) throw new Error('uploadToFileSearchStore returned no name');
  return { fileId: id, storeName };
}

export async function deleteFile(tenant: TenantContext, fileResourceName: string): Promise<void> {
  const ai = client(tenant);
  try {
    // The resource name is "fileSearchStores/<store>/documents/<doc>"
    await ai.fileSearchStores.documents.delete({ name: fileResourceName });
  } catch (err) {
    logger.warn({ err, fileResourceName }, '[rag] delete failed');
  }
}

/**
 * Run Gemini grounded generation against the tenant's FileSearchStore and
 * return the synthesized retrieval text. We use this when the tenant's main
 * text model (e.g. Grok/OpenAI) can't natively call Gemini's file_search tool
 * — Gemini does the retrieval, we forward the answer as context.
 */
export async function queryCorpus(
  tenant: TenantContext,
  query: string,
  conversationId?: string | null,
): Promise<string> {
  if (!tenant.apiKeys.geminiCorpusId || !tenant.apiKeys.gemini) return '';
  try {
    const ai = client(tenant);
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
