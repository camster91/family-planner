/** Canonical account-chore deletion, exact retry receipt and dependent cascades
 * commit in one native batch. No callback can perform uncaptured domain writes. */
import { randomUUID } from "node:crypto";
import {
  AssistantSourceRefused,
  readAssistantSourceProof,
  type AssistantProofActor,
  type AssistantSourceGuard,
} from "@/lib/assistant-source-proof";
import {
  readDeleteTargetProof,
  type DeleteTargetGuard,
} from "@/lib/assistant-delete-target";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import {
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
  IDEMPOTENCY_PRUNE_PROBABILITY,
} from "@/lib/idempotency-key";
import type { EffectResult } from "@/lib/idempotency";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { d1WriteCheck, isD1WriteConflict } from "./write-check";
import { d1AssistantSourceChecks } from "./assistant-source";
import { d1DeleteTargetChecks } from "./assistant-delete-target";
import { readD1ChoreDeleteEligibility } from "./chore-delete-policy";
import { pruneD1ExpiredReceipts } from "./notification-preferences";
export class D1ChoreDeleteReceiptError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_IN_PROGRESS",
  ) {
    super(code);
  }
}
type Result = EffectResult & { replayed: boolean };
const result = (status: number, body: unknown, replayed = false): Result => ({
  status,
  body,
  replayed,
});
export async function deleteD1Chore(
  actor: AssistantProofActor,
  id: string,
  key: string | null,
  options: {
    database?: D1Store;
    now?: Date;
    sourceGuard?: AssistantSourceGuard;
    targetGuard?: DeleteTargetGuard;
  } = {},
): Promise<Result> {
  const store = options.database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(now)) throw new Error("Invalid chore deletion clock");
  const source = options.sourceGuard,
    target = options.targetGuard,
    kind = "chore_delete",
    scope = `user:${actor.userId}`,
    action = "chore.delete",
    hash = hashIdempotentRequest(action, { choreId: id });
  if (source) {
    if (
      !target ||
      !source.d1 ||
      source.d1.kind !== kind ||
      !source.actor ||
      source.actor.userId !== actor.userId ||
      source.actor.familyId !== actor.familyId ||
      source.actor.role !== actor.role ||
      source.actor.generation !== actor.generation
    )
      throw new AssistantSourceRefused();
    readAssistantSourceProof(source.d1.token, actor, kind);
  }
  if (target) {
    if (!target.d1 || target.d1.kind !== kind || target.d1.targetId !== id)
      throw new AssistantSourceRefused();
    readDeleteTargetProof(target.d1.token, actor, kind, id);
  }
  let prune = key !== null && Math.random() < IDEMPOTENCY_PRUNE_PROBABILITY;
  for (let attempt = 0; attempt < 16; attempt++) {
    const capture = await captureD1Reads(
      async (db) => {
        const user = await db.user.findUnique({
          where: { id: actor.userId },
          select: { family_id: true, role: true, token_version: true },
        });
        if (
          !user ||
          user.family_id !== actor.familyId ||
          user.role !== actor.role ||
          user.token_version !== actor.generation
        )
          return { reply: result(401, { error: "Unauthorized" }) };
        if (!["parent", "teen", "child"].includes(user.role))
          return {
            reply: result(403, {
              error: "Only parents can perform this action",
            }),
          };
        const family = await db.family.findUnique({
          where: { id: actor.familyId },
          select: { features: true },
        });
        if (!family)
          return { reply: result(404, { error: "Household not found" }) };
        if (!isFeatureEnabled(normalizeFeatures(family.features), "chores"))
          return {
            reply: result(403, {
              error: "This feature is turned off for your family",
            }),
          };
        const prior =
          key === null
            ? null
            : await db.idempotencyRecord.findUnique({
                where: { scope_key: { scope, key } },
              });
        if (prior && prior.expires_at.getTime() > now) {
          if (
            prior.family_id !== actor.familyId ||
            prior.action !== action ||
            prior.request_hash !== hash
          )
            throw new D1ChoreDeleteReceiptError("IDEMPOTENCY_KEY_REUSED");
          if (prior.response_status !== null) {
            if (prior.response_body === null)
              throw new D1ChoreDeleteReceiptError("IDEMPOTENCY_IN_PROGRESS");
            return {
              reply: result(prior.response_status, prior.response_body, true),
            };
          }
          if (prior.created_at.getTime() > now - IDEMPOTENCY_LOCK_TIMEOUT_MS)
            throw new D1ChoreDeleteReceiptError("IDEMPOTENCY_IN_PROGRESS");
        }
        return {
          prior,
          denied: await readD1ChoreDeleteEligibility(db, actor, id),
        };
      },
      store as unknown as NativeD1,
    );
    if ("reply" in capture.value) {
      try {
        await session.batch(capture.checks(session));
        return capture.value.reply!;
      } catch (cause) {
        if (!isD1WriteConflict(cause)) throw cause;
        continue;
      }
    }
    if (prune) {
      prune = false;
      try {
        await pruneD1ExpiredReceipts(session, now);
      } catch {
        console.warn("[idempotency] Expired receipt cleanup could not finish");
      }
    }
    const { prior, denied } = capture.value,
      checks = capture.checks(session);
    try {
      if (source)
        checks.push(
          ...(await d1AssistantSourceChecks(store, actor, kind, source)).checks(
            session,
          ),
        );
      if (target)
        checks.push(
          ...(
            await d1DeleteTargetChecks(store, actor, kind, id, target)
          ).checks(session),
        );
    } catch (cause) {
      // A same-key winner can delete the reviewed target between our receipt
      // lookup and proof capture. Only its exact completed receipt admits replay.
      if (
        cause instanceof AssistantSourceRefused &&
        key !== null &&
        (await session
          .prepare(
            `SELECT id FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2 AND family_id=?3 AND action=?4 AND request_hash=?5 AND response_status IS NOT NULL AND expires_at>?6`,
          )
          .bind(scope, key, actor.familyId, action, hash, now)
          .first())
      )
        continue;
      throw cause;
    }
    const effects = [];
    if (prior)
      effects.push(
        session
          .prepare(`DELETE FROM "IdempotencyRecord" WHERE id=?1`)
          .bind(prior.id),
      );
    if (!denied) {
      effects.push(
        session
          .prepare(`DELETE FROM "Chore" WHERE id=?1 AND family_id=?2`)
          .bind(id, actor.familyId),
        d1WriteCheck(session, "changes()=1"),
      );
      if (key !== null)
        effects.push(
          session
            .prepare(
              `INSERT INTO "IdempotencyRecord"(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,200,?8,?9,?10)`,
            )
            .bind(
              prior && prior.expires_at.getTime() > now
                ? prior.id
                : randomUUID(),
              scope,
              key,
              actor.familyId,
              actor.userId,
              action,
              hash,
              JSON.stringify({ success: true }),
              now,
              prior && prior.expires_at.getTime() > now
                ? prior.expires_at.getTime()
                : now + IDEMPOTENCY_TTL_MS,
            ),
        );
    }
    try {
      await session.batch([...checks, ...effects]);
      return denied
        ? { ...denied, replayed: false }
        : result(200, { success: true });
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new D1ChoreDeleteReceiptError("IDEMPOTENCY_IN_PROGRESS");
}
