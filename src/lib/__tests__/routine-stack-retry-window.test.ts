// Pure source cases authored UNRUN; no clock, provider or storage action ran.
import { IDEMPOTENCY_TTL_MS } from "@/lib/idempotency-key";
import { ROUTINE_STACK_RETRY_MS, routineStackRetryWindowOpen } from "../routine-stack-retry-window";
const now = Date.parse("2026-10-25T12:00:00.000Z");
const iso = (time: number) => new Date(time).toISOString();
it('keeps the retry window comfortably inside receipt retention', () => {
  expect(ROUTINE_STACK_RETRY_MS).toBeLessThan(IDEMPOTENCY_TTL_MS / 2);
  expect(routineStackRetryWindowOpen(iso(now), now)).toBe(true);
  expect(routineStackRetryWindowOpen(iso(now - ROUTINE_STACK_RETRY_MS + 1), now)).toBe(true);
  expect(routineStackRetryWindowOpen(iso(now - ROUTINE_STACK_RETRY_MS), now)).toBe(false);
  expect(routineStackRetryWindowOpen(iso(now - IDEMPOTENCY_TTL_MS), now)).toBe(false);
});
it('refuses clock rollback beyond five minutes and noncanonical issue times', () => {
  expect(routineStackRetryWindowOpen(iso(now + 5 * 60 * 1000), now)).toBe(true);
  expect(routineStackRetryWindowOpen(iso(now + 5 * 60 * 1000 + 1), now)).toBe(false);
  for (const value of ['', '2026-10-25', '2026-10-25T12:00:00Z', '2026-10-25T12:00:00.000+00:00', '1970-01-01T00:00:00.000Z', 'invalid'])
    expect(routineStackRetryWindowOpen(value, now)).toBe(false);
  expect(routineStackRetryWindowOpen(iso(now), NaN)).toBe(false);
});
