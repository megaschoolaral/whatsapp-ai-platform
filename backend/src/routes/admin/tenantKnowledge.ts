import { Router } from 'express';
import multer from 'multer';
import { prisma } from '../../prisma.js';
import { requireAuth, requireRole } from '../../auth/middleware.js';
import { loadTenantContext } from '../../services/tenantContext.js';
import { ensureCorpus, uploadFileToCorpus, deleteFile } from '../../services/ai/rag.js';

export const adminTenantKnowledgeRouter = Router({ mergeParams: true });
adminTenantKnowledgeRouter.use(requireAuth, requireRole('super_admin'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/json',
]);

adminTenantKnowledgeRouter.get('/', async (req, res) => {
  const files = await prisma.knowledgeFile.findMany({
    where: { tenantId: (req.params as Record<string,string>).tenantId },
    orderBy: { createdAt: 'desc' },
  });
  res.json(files);
});

adminTenantKnowledgeRouter.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  if (!ALLOWED_MIME.has(req.file.mimetype)) {
    res.status(400).json({ error: 'Unsupported file type' });
    return;
  }
  const tenant = await loadTenantContext((req.params as Record<string,string>).tenantId);
  if (!tenant) {
    res.status(404).json({ error: 'Tenant not found' });
    return;
  }
  if (!tenant.apiKeys.gemini) {
    res.status(400).json({ error: 'Gemini key required for knowledge base' });
    return;
  }

  let corpusName = tenant.apiKeys.geminiCorpusId;
  if (!corpusName) {
    corpusName = await ensureCorpus(tenant);
    await prisma.tenantApiKeys.update({
      where: { tenantId: tenant.id },
      data: { geminiCorpusId: corpusName },
    });
  }

  let geminiFileId: string | null = null;
  try {
    const result = await uploadFileToCorpus(
      tenant,
      corpusName,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype,
    );
    geminiFileId = result.fileId;
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
    return;
  }

  const saved = await prisma.knowledgeFile.create({
    data: {
      tenantId: tenant.id,
      filename: req.file.originalname,
      fileSizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      geminiFileId,
      geminiCorpusId: corpusName,
      uploadedById: req.user!.userId,
    },
  });
  res.status(201).json(saved);
});

adminTenantKnowledgeRouter.delete('/:fileId', async (req, res) => {
  const file = await prisma.knowledgeFile.findUnique({ where: { id: (req.params as Record<string,string>).fileId } });
  if (!file || file.tenantId !== (req.params as Record<string,string>).tenantId) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (file.geminiFileId) {
    const tenant = await loadTenantContext((req.params as Record<string,string>).tenantId);
    if (tenant) await deleteFile(tenant, file.geminiFileId).catch(() => undefined);
  }
  await prisma.knowledgeFile.delete({ where: { id: file.id } });
  res.json({ ok: true });
});
