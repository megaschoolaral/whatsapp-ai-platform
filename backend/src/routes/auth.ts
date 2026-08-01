import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
});

const sensitiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again later.' },
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  // Always run bcrypt to prevent timing-based email enumeration (valid 60-char hash required)
  const sentinel = '$2a$10$/3SK7iTsoZElmbaksQrSpOwlBQhONzGmFRP3eaIS195TcIjdM5U.u';
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? sentinel);
  if (!user || !user.isActive || !ok) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const tenant = user.role === 'tenant_admin' ? await prisma.tenant.findFirst({ where: { ownerUserId: user.id } }) : null;
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = signToken({ userId: user.id, role: user.role, tenantId: tenant?.id ?? null });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
      tenantId: tenant?.id ?? null,
    },
  });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const tenant = user.role === 'tenant_admin' ? await prisma.tenant.findFirst({ where: { ownerUserId: user.id } }) : null;
  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    tenantId: tenant?.id ?? null,
  });
});

const changePwSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8) });
authRouter.post('/change-password', sensitiveLimiter, requireAuth, async (req, res) => {
  const parsed = changePwSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const ok = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: 'Invalid current password' });
    return;
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      mustChangePassword: false,
    },
  });
  res.json({ ok: true });
});
