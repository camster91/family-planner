import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
/** Original issue time is intent, never actor/household authority. */
export const ROUTINE_STACK_ISSUED_AT_HEADER = "X-Herewoven-Routine-Issued-At";
export const ROUTINE_STACK_RETRY_MS = Math.min(24 * 60 * 60 * 1000, Math.floor(IDEMPOTENCY_TTL_MS / 4));
export function routineStackRetryWindowOpen(issuedAt: string, now = Date.now()): boolean {
  if (typeof issuedAt !== "string" || issuedAt.length !== 24 || !Number.isFinite(now)) return false;
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued) || issued <= 0 || new Date(issued).toISOString() !== issuedAt) return false;
  return issued <= now + 5 * 60 * 1000 && now - issued < ROUTINE_STACK_RETRY_MS;
}
export const ROUTINE_STACK_WINDOW_CLOSED = "ROUTINE_STACK_WINDOW_CLOSED";
