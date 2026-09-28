// OAuth state (#264): single use, short expiry, bound to member + household +
// provider; only a hash is stored; PKCE S256.

import { createHash } from "crypto";
import { db, fakePrisma, FAMILY_A, FAMILY_B } from "@/__tests__/helpers/two-household";
import {
  consumeOAuthState,
  createOAuthState,
  hashState,
  pkcePair,
  STATE_TTL_MS,
} from "../oauth";
import { clearSyncEnv, setSyncEnv } from "./fakes";

const NOW = new Date("2026-09-28T12:00:00Z");

beforeAll(() => setSyncEnv());
afterAll(() => clearSyncEnv());
beforeEach(() => db.reset());

async function start(userId = "parent-a", familyId = FAMILY_A) {
  return createOAuthState(fakePrisma, { familyId, userId, provider: "google", now: NOW });
}

const consume = (state: string, over: Partial<Parameters<typeof consumeOAuthState>[1]> = {}) =>
  consumeOAuthState(fakePrisma, {
    state,
    familyId: FAMILY_A,
    userId: "parent-a",
    provider: "google",
    now: new Date(NOW.getTime() + 1000),
    ...over,
  });

describe("OAuth state", () => {
  it("stores only a hash of the state and an encrypted verifier", async () => {
    const { state, codeChallenge } = await start();
    const [row] = db.rows("calendarOAuthState");
    expect(JSON.stringify(row)).not.toContain(state);
    expect(row.state_hash).toBe(hashState(state));
    expect(row.code_verifier_enc.startsWith("ct1.")).toBe(true);
    expect(row.expires_at.getTime() - NOW.getTime()).toBe(STATE_TTL_MS);
    const ok = await consume(state);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(createHash("sha256").update(ok.codeVerifier).digest("base64url")).toBe(codeChallenge);
    }
  });

  it("is single use (replay refused)", async () => {
    const { state } = await start();
    expect((await consume(state)).ok).toBe(true);
    expect(await consume(state)).toEqual({ ok: false, reason: "replayed" });
  });

  it("refuses another member, another household or another provider, and burns the state", async () => {
    const { state } = await start();
    expect(await consume(state, { userId: "teen-a" })).toEqual({ ok: false, reason: "wrong_user" });
    expect(await consume(state)).toEqual({ ok: false, reason: "replayed" });

    const s2 = (await start()).state;
    expect(await consume(s2, { userId: "parent-b", familyId: FAMILY_B })).toEqual({ ok: false, reason: "wrong_user" });
    const s3 = (await start()).state;
    expect(await consume(s3, { provider: "microsoft" })).toEqual({ ok: false, reason: "wrong_user" });
  });

  it("expires after 10 minutes", async () => {
    const { state } = await start();
    expect(await consume(state, { now: new Date(NOW.getTime() + STATE_TTL_MS + 1) })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses unknown, empty and oversized states", async () => {
    await start();
    expect(await consume("made-up")).toEqual({ ok: false, reason: "invalid" });
    expect(await consume("")).toEqual({ ok: false, reason: "invalid" });
    expect(await consume("x".repeat(500))).toEqual({ ok: false, reason: "invalid" });
  });

  it("cleans up this member's used and expired states", async () => {
    const { state } = await start();
    await consume(state);
    await createOAuthState(fakePrisma, {
      familyId: FAMILY_A,
      userId: "parent-a",
      provider: "google",
      now: new Date(NOW.getTime() + 2 * STATE_TTL_MS),
    });
    expect(db.rows("calendarOAuthState")).toHaveLength(1);
  });

  it("PKCE pairs are S256 and unique", () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(createHash("sha256").update(a.verifier).digest("base64url")).toBe(a.challenge);
  });
});
