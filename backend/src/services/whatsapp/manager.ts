import type makeWASocket from 'baileys';

type Sock = ReturnType<typeof makeWASocket>;

interface SessionEntry {
  sock: Sock;
  status: 'connecting' | 'qr' | 'connected' | 'closed';
  lastQr: string | null;
}

const sessions = new Map<string, SessionEntry>();

export function getSession(tenantId: string): SessionEntry | undefined {
  return sessions.get(tenantId);
}

export function setSession(tenantId: string, entry: SessionEntry): void {
  sessions.set(tenantId, entry);
}

export function updateSession(tenantId: string, patch: Partial<SessionEntry>): void {
  const cur = sessions.get(tenantId);
  if (!cur) return;
  sessions.set(tenantId, { ...cur, ...patch });
}

export function removeSession(tenantId: string): void {
  sessions.delete(tenantId);
}

export function listSessions(): Array<{ tenantId: string; status: SessionEntry['status'] }> {
  return Array.from(sessions.entries()).map(([tenantId, e]) => ({ tenantId, status: e.status }));
}
