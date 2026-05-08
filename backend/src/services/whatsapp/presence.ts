import { extendBufferTimer } from '../inboundBuffer/buffer.js';

export async function handlePresenceUpdate(
  tenantId: string,
  jid: string,
  presences: Record<string, { lastKnownPresence?: string }>,
): Promise<void> {
  for (const [, p] of Object.entries(presences)) {
    if (p.lastKnownPresence === 'composing') {
      await extendBufferTimer(tenantId, jid, 'composing');
    } else if (p.lastKnownPresence === 'paused') {
      await extendBufferTimer(tenantId, jid, 'paused');
    }
  }
}
