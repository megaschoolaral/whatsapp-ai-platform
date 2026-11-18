/**
 * Baileys reports reason 500 (`badSession`) as its fallback for any WhatsApp `stream:error` it cannot
 * classify (e.g. an `ack` for a status upload) — not only for a truly corrupted session. The stored
 * creds are intact in those cases, so a plain reconnect usually works. We retry a few times with
 * backoff before treating it as "needs a manual QR scan".
 */
export const BAD_SESSION_RETRY_DELAYS_MS = [10_000, 60_000, 3 * 60_000];
/** A connection must stay up this long before earlier 500s are forgiven (guards against flapping). */
export const STABLE_AFTER_MS = 10 * 60_000;

const attempts = new Map<string, number>();
const stableTimers = new Map<string, NodeJS.Timeout>();

function clearStableTimer(tenantId: string): void {
  clearTimeout(stableTimers.get(tenantId));
  stableTimers.delete(tenantId);
}

/**
 * Registers one more `badSession` close. Returns the delay before the next reconnect attempt,
 * or `null` once the retry budget is used up (manual re-auth needed).
 */
export function nextBadSessionDelay(tenantId: string): number | null {
  clearStableTimer(tenantId);
  const used = attempts.get(tenantId) ?? 0;
  if (used >= BAD_SESSION_RETRY_DELAYS_MS.length) return null;
  attempts.set(tenantId, used + 1);
  return BAD_SESSION_RETRY_DELAYS_MS[used]!;
}

/** The socket opened: forget earlier 500s only if it then stays up for STABLE_AFTER_MS. */
export function recordConnectionOpen(tenantId: string): void {
  clearStableTimer(tenantId);
  if (!attempts.has(tenantId)) return;
  const t = setTimeout(() => {
    stableTimers.delete(tenantId);
    attempts.delete(tenantId);
  }, STABLE_AFTER_MS);
  t.unref?.();
  stableTimers.set(tenantId, t);
}

/** Deliberate disconnect/reset: start from a clean budget next time. */
export function resetBadSessionRetries(tenantId: string): void {
  clearStableTimer(tenantId);
  attempts.delete(tenantId);
}
