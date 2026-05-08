import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function connectSocket(token: string, tenantId?: string | null): Socket {
  if (socket) socket.disconnect();
  socket = io({
    auth: { token },
    query: tenantId ? { tenantId } : undefined,
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  if (socket) socket.disconnect();
  socket = null;
}
