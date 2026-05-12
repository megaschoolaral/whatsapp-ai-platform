import { prisma } from '../prisma.js';
import { hashPassword } from '../auth/password.js';
import { logger } from '../logger.js';
import { env } from '../env.js';

export async function bootstrapSuperAdmin(): Promise<void> {
  const exists = await prisma.user.findFirst({ where: { role: 'super_admin' } });
  if (exists) return;

  if (!env.SUPER_ADMIN_EMAIL || !env.SUPER_ADMIN_PASSWORD) {
    logger.warn('[bootstrap] No super_admin in DB and SUPER_ADMIN_EMAIL/PASSWORD env not set. Skipping bootstrap.');
    return;
  }
  const placeholders = new Set(['change_me_immediately', 'changeme', 'password', 'admin']);
  if (placeholders.has(env.SUPER_ADMIN_PASSWORD) || env.SUPER_ADMIN_PASSWORD.length < 12) {
    logger.error('[bootstrap] SUPER_ADMIN_PASSWORD is a placeholder or too short (<12 chars). Refusing to create super-admin. Set a strong password and restart.');
    return;
  }
  const passwordHash = await hashPassword(env.SUPER_ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      email: env.SUPER_ADMIN_EMAIL,
      passwordHash,
      role: 'super_admin',
      isActive: true,
      mustChangePassword: true,
    },
  });
  logger.info('[bootstrap] Super-admin created. Remove SUPER_ADMIN_PASSWORD env var now.');
}
