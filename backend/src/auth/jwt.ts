import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../env.js';

export interface JwtPayload {
  userId: string;
  role: 'super_admin' | 'tenant_admin';
  tenantId?: string | null;
}

export function signToken(payload: JwtPayload, expiresIn: SignOptions['expiresIn'] = '7d'): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
