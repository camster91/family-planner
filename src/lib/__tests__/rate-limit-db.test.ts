jest.mock("@/lib/prisma", () => ({
  prisma: undefined,
}));

import { checkRateLimit } from "@/lib/rate-limit-db";

let keyCounter = 0;
const nextKey = () => `rate-limit-test:${++keyCounter}`;

describe("Postgres-backed rate limiter contract", () => {
  it("allows requests up to the configured limit", async () => {
    const key = nextKey();

    const first = await checkRateLimit(key, 2, 60_000);
    const second = await checkRateLimit(key, 2, 60_000);

    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("rejects the request after the configured limit", async () => {
    const key = nextKey();

    await checkRateLimit(key, 2, 60_000);
    await checkRateLimit(key, 2, 60_000);
    const blocked = await checkRateLimit(key, 2, 60_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it("starts a new window after the current window expires", async () => {
    jest.useFakeTimers();

    try {
      const key = nextKey();

      await checkRateLimit(key, 1, 1_000);
      const blocked = await checkRateLimit(key, 1, 1_000);
      jest.advanceTimersByTime(1_001);
      const afterReset = await checkRateLimit(key, 1, 1_000);

      expect(blocked.allowed).toBe(false);
      expect(afterReset).toMatchObject({ allowed: true, remaining: 0 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps limits independent for different keys", async () => {
    const firstKey = nextKey();
    const secondKey = nextKey();

    await checkRateLimit(firstKey, 1, 60_000);
    const firstBlocked = await checkRateLimit(firstKey, 1, 60_000);
    const secondAllowed = await checkRateLimit(secondKey, 1, 60_000);

    expect(firstBlocked.allowed).toBe(false);
    expect(secondAllowed).toMatchObject({ allowed: true, remaining: 0 });
  });
});
