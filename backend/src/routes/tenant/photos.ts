import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireAuth, tenantIsolation } from '../../auth/middleware.js';
import { isPhotoCategory } from '../../services/photos/categories.js';
import {
  addPhoto,
  deletePhoto,
  getPhotoData,
  InvalidImageError,
  listPhotoSummary,
  PhotoLimitError,
} from '../../services/photos/store.js';

export const tenantPhotosRouter = Router();
tenantPhotosRouter.use(requireAuth, tenantIsolation);

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES } });

export async function listPhotosHandler(req: Request, res: Response): Promise<void> {
  res.json({ categories: await listPhotoSummary(req.tenantScope!) });
}

export async function uploadPhotoHandler(req: Request, res: Response): Promise<void> {
  const category = req.params.category;
  if (!isPhotoCategory(category)) {
    res.status(400).json({ error: 'Unknown category' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'File is required' });
    return;
  }
  try {
    const { id } = await addPhoto(req.tenantScope!, category, req.file.buffer, req.file.mimetype);
    res.status(201).json({ id });
  } catch (err) {
    if (err instanceof InvalidImageError) {
      res.status(400).json({ error: 'Файл не является изображением' });
      return;
    }
    if (err instanceof PhotoLimitError) {
      res.status(409).json({ error: 'В категории уже 10 фото' });
      return;
    }
    throw err;
  }
}

export async function deletePhotoHandler(req: Request, res: Response): Promise<void> {
  const ok = await deletePhoto(req.tenantScope!, req.params.id);
  if (!ok) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.status(204).end();
}

export async function photoImageHandler(req: Request, res: Response): Promise<void> {
  const photo = await getPhotoData(req.tenantScope!, req.params.id);
  if (!photo) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.setHeader('Content-Type', photo.mimeType);
  res.send(photo.data);
}

/** Turns multer's size-limit error into a clear 413 instead of a generic 500. */
export function photoUploadErrorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: 'Файл больше 10 МБ — не загружен. Уменьшите фото и попробуйте снова.' });
    return;
  }
  next(err);
}

tenantPhotosRouter.get('/photos', listPhotosHandler);
tenantPhotosRouter.post('/photos/:category', upload.single('file'), uploadPhotoHandler);
tenantPhotosRouter.delete('/photos/:id', deletePhotoHandler);
tenantPhotosRouter.get('/photos/:id/image', photoImageHandler);
tenantPhotosRouter.use(photoUploadErrorHandler);
