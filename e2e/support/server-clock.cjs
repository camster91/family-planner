/**
 * E2E-only server clock shift (#155).
 *
 * Loaded into the Next.js server by playwright.config.ts through
 * `NODE_OPTIONS=--require ./e2e/support/server-clock.cjs`. It is never imported
 * by application code and never loaded in production.
 *
 * Why: the dashboard and other server components compute "upcoming" windows
 * from `new Date()` on the server. The fixtures (#154) are anchored to
 * FIXTURES_ANCHOR_DATE (default 2026-01-05T12:00:00Z), so without this the
 * server would compare January fixture rows against the real wall clock and
 * render nothing "upcoming". The browser clock is fixed separately with
 * `page.clock` (see e2e/support/fixtures.ts).
 *
 * Behaviour: when E2E_SERVER_NOW is a valid date, `Date.now()` and
 * `new Date()` start at that instant when the process boots and then tick
 * forward in real time (a shift, not a freeze, so JWT expiry, rate-limit
 * windows and timers keep working). Explicit dates (`new Date(x)`) are
 * untouched. Refuses to load under NODE_ENV=production unless
 * E2E_ALLOW_SERVER_CLOCK=1 is also set (the local e2e server runs
 * `next start`, which uses NODE_ENV=production).
 */
"use strict";

const raw = process.env.E2E_SERVER_NOW;
if (raw) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.E2E_ALLOW_SERVER_CLOCK !== "1"
  ) {
    throw new Error(
      "e2e/support/server-clock.cjs refused: set E2E_ALLOW_SERVER_CLOCK=1 (test servers only).",
    );
  }
  const target = Date.parse(raw);
  if (Number.isNaN(target)) {
    throw new Error(
      `E2E_SERVER_NOW is not a valid date: ${JSON.stringify(raw)}`,
    );
  }
  const RealDate = Date;
  const offset = target - RealDate.now();

  function ShiftedDate(...args) {
    if (!new.target) {
      // `Date()` called as a function returns a string.
      return new RealDate(RealDate.now() + offset).toString();
    }
    return args.length === 0
      ? new RealDate(RealDate.now() + offset)
      : new RealDate(...args);
  }
  ShiftedDate.prototype = RealDate.prototype;
  // Own statics (not just a prototype link): some bundled server code resolves
  // Date statics in ways that skip the prototype chain.
  ShiftedDate.parse = RealDate.parse;
  ShiftedDate.UTC = RealDate.UTC;
  ShiftedDate.now = () => RealDate.now() + offset;
  globalThis.Date = ShiftedDate;
}
