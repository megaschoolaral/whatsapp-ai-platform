import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type JwtPayload } from './jwt.js';
import { prisma } from '../prisma.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenantScope?: string | 'ALL';
      params: Record<string, string>;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  let payload: JwtPayload;
  try {
    payload = verifyToken(header.slice('Bearer '.length));
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  // Tokens live 7 days, so re-check the account on every request: deactivated users are cut off
  // immediately and a pending forced password change can't be bypassed by calling the API directly.
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { isActive: true, mustChangePassword: true },
  });
  if (!user || !user.isActive) {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }
  if (user.mustChangePassword && !req.originalUrl.startsWith('/api/auth/')) {
    res.status(403).json({ error: 'Password change required' });
    return;
  }
  req.user = payload;
  next();
}

export function requireRole(...roles: Array<'super_admin' | 'tenant_admin'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}

/**
 * For routes scoped to a single tenant (tenant_admin always; super_admin via :tenantId param).
 * Sets req.tenantScope to the resolved tenant id.
 */
export async function tenantIsolation(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.user.role === 'super_admin') {
    const tid = (req.params.tenantId as string | undefined) ?? (req.query.tenantId as string | undefined);
    if (!tid) {
      res.status(400).json({ error: 'tenantId required for super_admin scope' });
      return;
    }
    req.tenantScope = tid;
  } else {
    if (!req.user.tenantId) {
      res.status(403).json({ error: 'No tenant attached to user' });
      return;
    }
    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId }, select: { status: true } });
    if (!tenant) {
      res.status(403).json({ error: 'No tenant attached to user' });
      return;
    }
    if (tenant.status === 'suspended') {
      res.status(403).json({ error: 'Tenant suspended' });
      return;
    }
    req.tenantScope = req.user.tenantId;
  }
  next();
}
