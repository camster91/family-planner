/** D1 adapter for foreground meal-prep recovery. */
import { NextResponse, type NextRequest } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { boundedRequestText, RequestBodyTooLarge } from "@/lib/bounded-request-text";
import { idempotencyError, readIdempotencyKey } from "@/lib/idempotency";
import { prepAction, prepCommand, prepContext, prepRecoveryInput, prepRecoveryReply, prepReceipt, prepReceiptMatches, prepStatus, PREP_OWNER_HEADER, PREP_RECOVERY, PREP_INTENT_MS, type PrepCommand } from "@/lib/meal-prep-recovery/contract";
import { prepRecoveryEnabled, prepRequestOwner } from "@/lib/meal-prep-recovery/owner";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import { getD1Database, type D1Store } from "./database";
import { authorizeD1MealPrep, mutateD1MealPrep } from "./meal-bulk";
import { D1PersonReceiptError } from "./person-effect";
import { withD1ReadClient } from "./read-client";

const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) => ({ status, body: { error: { code } } });
const json = (result: { status: number; body: unknown }) => NextResponse.json(result.body, { status: result.status, headers });
const leaseCurrent = (command: PrepCommand, now = Date.now()) => {
  const issued = Date.parse(command.issuedAt);
  return Number.isFinite(issued) && issued <= now + 1000 && now < issued + PREP_INTENT_MS;
};
const ownerScope = (owner: { scope: string }) => owner.scope;
function parseStoredBody(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

async function record(db: D1Store, actor: { userId: string; familyId: string }, key: string) {
  return db.withSession("first-primary").prepare(`SELECT user_id,family_id,action,request_hash,response_status,response_body,created_at,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`).bind(`user:${actor.userId}`, key).first<{ user_id: string | null; family_id: string; action: string; request_hash: string; response_status: number | null; response_body: unknown; created_at: number; expires_at: number }>();
}

export async function handleD1PrepRecoveryHttp(request: NextRequest, mode: "context" | "inspect" | "apply") {
  try {
    const paired = await refusePairedDevice(request); if (paired) { paired.headers.set("Cache-Control", "private, no-store"); return paired; }
    const [auth, error] = await authenticateWithFamily(request); if (error) { error.headers.set("Cache-Control", "private, no-store"); return error; }
    const actor = { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 };
    const denied = await withD1ReadClient((db) => authorizeD1MealPrep(db, actor));
    if (denied) return json(denied);
    const owner = prepRequestOwner(request, { ...auth.payload, family_id: actor.familyId, role: actor.role, tv: actor.generation });
    if (mode === "context") return NextResponse.json(prepContext.parse({ contract: PREP_RECOVERY, enabled: owner !== null && prepRecoveryEnabled(), owner, userId: actor.userId, familyId: actor.familyId, role: actor.role }), { headers });
    if (!owner || request.headers.get(PREP_OWNER_HEADER) !== ownerScope(owner)) return json(fail(403, "AUTH_CONTEXT_CHANGED"));
    const input = prepRecoveryInput.parse(JSON.parse(await boundedRequestText(request, 196608)));
    const command = prepCommand.parse(JSON.parse(input.entry.body));
    if (command.generation !== actor.generation || command.role !== actor.role || command.input.expected_user_id !== actor.userId || command.input.expected_family_id !== actor.familyId) return json(fail(403, "AUTH_CONTEXT_CHANGED"));
    const db = await getD1Database();
    const key = input.entry.key;
    if (mode === "inspect") {
      // Native effects receipt the canonical domain input; the command's
      // transport envelope remains owner/lease metadata and is not persisted
      // in the D1 mutation hash.
      const current = await record(db, actor, key), requestHash = hashIdempotentRequest(prepAction(command), command.input);
      if (current && (current.family_id !== actor.familyId || current.user_id !== actor.userId || current.action !== prepAction(command) || current.request_hash !== requestHash)) return NextResponse.json(prepRecoveryReply.parse({ contract: PREP_RECOVERY, ownerScope: owner.scope, entry: input.entry, requestHash, state: "conflict", canRetry: false, retryUntil: null, receipt: null }), { headers });
      const parsedReceipt = current && current.response_status !== null && current.response_body !== null ? prepReceipt.safeParse(parseStoredBody(current.response_body)) : null;
      const committed = Boolean(parsedReceipt?.success);
      const receiptBody = parsedReceipt && parsedReceipt.success ? parsedReceipt.data : null;
      const expired = !leaseCurrent(command) || Boolean(current && current.expires_at <= Date.now());
      const state = committed ? "committed" : expired ? "expired" : current ? "pending" : prepRecoveryEnabled() ? "ready" : "paused";
      return NextResponse.json(prepRecoveryReply.parse({ contract: PREP_RECOVERY, ownerScope: owner.scope, entry: input.entry, requestHash, state, canRetry: state === "ready", retryUntil: state === "ready" ? new Date(Date.parse(command.issuedAt) + PREP_INTENT_MS).toISOString() : null, receipt: committed ? receiptBody : null }), { headers });
    }
    const keyHeader = readIdempotencyKey(request); if (keyHeader.error) return keyHeader.error; if (!keyHeader.key || keyHeader.key !== key) return json(fail(400, "IDEMPOTENCY_KEY_REQUIRED"));
    if (!prepRecoveryEnabled() || !leaseCurrent(command)) return json(fail(409, !prepRecoveryEnabled() ? "RECOVERY_PAUSED" : "INTENT_EXPIRED"));
    const result = await mutateD1MealPrep(actor, command.input as any, key, db);
    const receipt = prepReceipt.safeParse(result.body);
    if (result.status !== prepStatus(command) || !receipt.success || !prepReceiptMatches(result.body, command)) return json(fail(409, "SAVE_UNCONFIRMED"));
    return json({ status: result.status, body: receipt.data });
  } catch (cause) {
    if (cause instanceof RequestBodyTooLarge) return json(fail(413, "INVALID_DRAFT"));
    if (cause instanceof D1PersonReceiptError) return json(idempotencyError(cause.code));
    return json(fail(mode === "apply" ? 500 : 409, mode === "apply" ? "SAVE_UNCONFIRMED" : "UNAVAILABLE"));
  }
}
