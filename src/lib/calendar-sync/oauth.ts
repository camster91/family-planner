// OAuth state + PKCE for connecting a calendar (#264).
//
// `state` is 256 bits of randomness. Only its SHA-256 is stored, together with
// the household, the member who started the flow, the provider, and the PKCE
// verifier (encrypted). The callback consumes it atomically, once, within
// STATE_TTL_MS, and only for the same signed-in member and household.

import { createHash, randomBytes } from "crypto";
import type { Provider } from "./config";
import { decryptToken, encryptToken, tokenAad } from "./token-crypto";

export const STATE_TTL_MS = 10 * 60 * 1000;

export const hashState = (state: string) =>
  createHash("sha256").update(state, "utf8").digest("hex");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function createOAuthState(
  db: any,
  args: { familyId: string; userId: string; provider: Provider; now?: Date },
): Promise<{ state: string; codeChallenge: string }> {
  const now = args.now ?? new Date();
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkcePair();
  // Housekeeping: drop this member's expired or used states.
  await db.calendarOAuthState.deleteMany({
    where: {
      user_id: args.userId,
      OR: [{ expires_at: { lt: now } }, { used_at: { not: null } }],
    },
  });
  await db.calendarOAuthState.create({
    data: {
      state_hash: hashState(state),
      family_id: args.familyId,
      user_id: args.userId,
      provider: args.provider,
      code_verifier_enc: encryptToken(verifier, tokenAad.verifier(args.familyId)),
      expires_at: new Date(now.getTime() + STATE_TTL_MS),
    },
  });
  return { state, codeChallenge: challenge };
}

export type ConsumeStateResult =
  | { ok: true; codeVerifier: string }
  | { ok: false; reason: "invalid" | "expired" | "replayed" | "wrong_user" };

/**
 * Consume a state exactly once. Any presented state that matches a row is
 * marked used, even when it is refused, so a leaked state cannot be retried.
 */
export async function consumeOAuthState(
  db: any,
  args: {
    state: string;
    familyId: string;
    userId: string;
    provider: Provider;
    now?: Date;
  },
): Promise<ConsumeStateResult> {
  const now = args.now ?? new Date();
  if (!args.state || args.state.length > 200) return { ok: false, reason: "invalid" };
  const row = await db.calendarOAuthState.findUnique({
    where: { state_hash: hashState(args.state) },
  });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.used_at) return { ok: false, reason: "replayed" };

  // Atomic single use: only one concurrent callback can flip used_at.
  const claimed = await db.calendarOAuthState.updateMany({
    where: { id: row.id, used_at: null },
    data: { used_at: now },
  });
  if (claimed.count !== 1) return { ok: false, reason: "replayed" };

  if (new Date(row.expires_at).getTime() <= now.getTime())
    return { ok: false, reason: "expired" };
  if (
    row.user_id !== args.userId ||
    row.family_id !== args.familyId ||
    row.provider !== args.provider
  )
    return { ok: false, reason: "wrong_user" };

  const codeVerifier = decryptToken(
    row.code_verifier_enc,
    tokenAad.verifier(row.family_id),
  );
  if (!codeVerifier) return { ok: false, reason: "invalid" };
  return { ok: true, codeVerifier };
}
