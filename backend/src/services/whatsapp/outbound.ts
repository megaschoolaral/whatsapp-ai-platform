import type makeWASocket from '@whiskeysockets/baileys';
import { delay, randomBetween } from '../../utils/delay.js';
import { canSendAndIncrement } from './antiBan.js';

type Sock = ReturnType<typeof makeWASocket>;

export async function sendHumanLikeText(args: {
  tenantId: string;
  sock: Sock;
  jid: string;
  text: string;
  markReadKey?: object;
}): Promise<{ sent: boolean; reason?: string }> {
  const limits = await canSendAndIncrement(args.tenantId);
  if (!limits.allowed) {
    return { sent: false, reason: limits.reason };
  }

  // 1. read delay 1-3s
  if (args.markReadKey) {
    await delay(randomBetween(1000, 3000));
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await args.sock.readMessages([args.markReadKey as any]);
    } catch {
      /* ignore */
    }
  }

  // 2. composing
  try {
    await args.sock.sendPresenceUpdate('composing', args.jid);
  } catch {
    /* ignore */
  }

  // 3. typing 50-80 ms/char (cap 8s)
  const typingMs = Math.min(args.text.length * randomBetween(50, 80), 8000);
  await delay(typingMs);

  // 4. paused + small gap
  try {
    await args.sock.sendPresenceUpdate('paused', args.jid);
  } catch {
    /* ignore */
  }
  await delay(randomBetween(300, 800));

  // 5. send
  await args.sock.sendMessage(args.jid, { text: args.text });
  return { sent: true };
}
