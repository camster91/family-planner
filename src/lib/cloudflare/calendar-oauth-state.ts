import type { Provider } from "@/lib/calendar-sync/config";
import { randomBytes } from "node:crypto";
import {
  decryptToken,
  encryptToken,
  tokenAad,
} from "@/lib/calendar-sync/token-crypto";
import { hashState, pkcePair, STATE_TTL_MS } from "@/lib/calendar-sync/oauth";
import { getD1Database, type D1Store, type SqlValue } from "./database";

export type CalendarOAuthActor = {
  userId: string;
  familyId: string;
  generation: number;
};

type OAuthRow = {
  id: string;
  state_hash: string;
  family_id: string;
  user_id: string;
  provider: string;
  code_verifier_enc: string;
  expires_at: number;
  used_at: number | null;
};

const AUTH = `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
  WHERE u.id=?1 AND u.family_id=?2 AND u.role='parent' AND u.token_version=?3)`;

function actorArgs(actor: CalendarOAuthActor): SqlValue[] {
  return [actor.userId, actor.familyId, actor.generation];
}

function validActor(actor: CalendarOAuthActor): boolean {
  return Number.isSafeInteger(actor.generation) && actor.generation >= 0;
}

/** Create a single-use state and encrypted PKCE verifier in one D1 batch. */
export async function createD1OAuthState(
  actor: CalendarOAuthActor,
  provider: Provider,
  now = new Date(),
  database?: D1Store,
): Promise<{ state: string; codeChallenge: string } | null> {
  if (!validActor(actor)) return null;
  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const stateHash = hashState(state);
  const result = await db.batch<OAuthRow>([
    db
      .prepare(
        `DELETE FROM "CalendarOAuthState" WHERE user_id=?1 AND (expires_at<?4 OR used_at IS NOT NULL)`,
      )
      .bind(...actorArgs(actor), now.getTime()),
    db
      .prepare(
        `INSERT INTO "CalendarOAuthState" (id,state_hash,family_id,user_id,provider,code_verifier_enc,expires_at)
      SELECT ?4,?5,?2,?1,?6,?7,?8 WHERE ${AUTH}`,
      )
      .bind(
        ...actorArgs(actor),
        crypto.randomUUID(),
        stateHash,
        provider,
        encryptToken(verifier, tokenAad.verifier(actor.familyId)),
        now.getTime() + STATE_TTL_MS,
      ),
    db
      .prepare(
        `SELECT id FROM "CalendarOAuthState" WHERE state_hash=?4 AND family_id=?2 AND user_id=?1`,
      )
      .bind(...actorArgs(actor), stateHash),
  ]);
  return result[1].meta.changes && result[2].results.length
    ? { state, codeChallenge: challenge }
    : null;
}

export type ConsumeD1OAuthStateResult =
  | { ok: true; codeVerifier: string }
  | { ok: false; reason: "invalid" | "expired" | "replayed" | "wrong_user" };

/** Consume state exactly once; a matching but refused state is still burned. */
export async function consumeD1OAuthState(
  actor: CalendarOAuthActor,
  args: { state: string; provider: Provider; now?: Date },
  database?: D1Store,
): Promise<ConsumeD1OAuthStateResult> {
  const state = args.state;
  const now = args.now ?? new Date();
  if (!validActor(actor) || !state || state.length > 200)
    return { ok: false, reason: "invalid" };
  const hash = hashState(state);
  const db = (database ?? (await getD1Database())).withSession("first-primary");
  const result = await db.batch<OAuthRow>([
    db
      .prepare(
        `SELECT id,state_hash,family_id,user_id,provider,code_verifier_enc,expires_at,used_at
      FROM "CalendarOAuthState" WHERE state_hash=?4`,
      )
      .bind(...actorArgs(actor), hash),
    db
      .prepare(
        `UPDATE "CalendarOAuthState" SET used_at=?5 WHERE state_hash=?4 AND used_at IS NULL RETURNING id,state_hash,family_id,user_id,provider,code_verifier_enc,expires_at,used_at`,
      )
      .bind(...actorArgs(actor), hash, now.getTime()),
  ]);
  const selected = result[0].results[0];
  if (!selected) return { ok: false, reason: "invalid" };
  if (!result[1].results.length) return { ok: false, reason: "replayed" };
  if (selected.expires_at <= now.getTime())
    return { ok: false, reason: "expired" };
  if (
    selected.user_id !== actor.userId ||
    selected.family_id !== actor.familyId ||
    selected.provider !== args.provider
  )
    return { ok: false, reason: "wrong_user" };
  const codeVerifier = decryptToken(
    selected.code_verifier_enc,
    tokenAad.verifier(selected.family_id),
  );
  return codeVerifier
    ? { ok: true, codeVerifier }
    : { ok: false, reason: "invalid" };
}
