import type { NextFunction, Request, Response } from 'express';
import { verifyToken, type JwtPayload } from './jwt.js';

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

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const token = header.slice('Bearer '.length);
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
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
export function tenantIsolation(req: Request, res: Response, next: NextFunction): void {
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
    req.tenantScope = req.user.tenantId;
  }
  next();
}
