/**
 * Setup project (#155): sign in once per fixture role through the real
 * /api/auth/login endpoint and save the browser state for the other projects.
 *
 * `/api/auth/login` is on the middleware's CSRF-exempt list (credentials are
 * the second factor), so no csrf_token is needed here. Everything after login
 * runs in a real browser, which receives and echoes the csrf_token cookie the
 * way the app expects.
 *
 * The UI login journey itself is covered in journeys.spec.ts; this file only
 * avoids repeating a login per test (the login endpoint is rate limited).
 */
import { test as setup, expect } from "@playwright/test";
import { FIXTURE_EMAILS, FIXTURE_PASSWORD } from "../src/lib/fixtures/dataset";
import { authFile } from "./support/env";

const accounts = [
  { who: "parentA", email: FIXTURE_EMAILS.familyA.parent },
  { who: "childA", email: FIXTURE_EMAILS.familyA.child },
  { who: "parentB", email: FIXTURE_EMAILS.familyB.parent },
] as const;

for (const { who, email } of accounts) {
  setup(`sign in ${who}`, async ({ request }) => {
    const res = await request.post("/api/auth/login", {
      data: { email, password: FIXTURE_PASSWORD },
    });
    expect(res.status(), await res.text()).toBe(200);
    await request.storageState({ path: authFile(who) });
  });
}
