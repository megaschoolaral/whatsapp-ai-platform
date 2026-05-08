import type { Server } from 'socket.io';

let io: Server | null = null;

export function setIo(server: Server): void {
  io = server;
}

export function getIo(): Server | null {
  return io;
}

export function emitToTenant(tenantId: string, event: string, payload: unknown): void {
  if (!io) return;
  io.to(`tenant-${tenantId}`).emit(event, payload);
}
