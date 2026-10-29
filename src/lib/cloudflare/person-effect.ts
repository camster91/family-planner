/** Native receipt coordinator: only explicit read plans and SQL effects, never
 * an interactive ORM transaction. Domain policy remains source-owned. */
import { randomUUID } from "node:crypto";
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import {
  IDEMPOTENCY_TTL_MS,
  IDEMPOTENCY_LOCK_TIMEOUT_MS,
} from "@/lib/idempotency-key";
import type { EffectResult } from "@/lib/idempotency";
import {
  type AssistantSourceGuard,
  type AssistantProofActor,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { getD1Database, type D1Store, type D1Statement } from "./database";
import { captureD1Reads } from "./read-witness";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import { d1AssistantSourceChecks } from "./assistant-source";
export type NativePersonPlan = EffectResult & {
  effects?: (session: Pick<D1Store, "prepare">) => D1Statement[];
};
export type NativePersonResult = EffectResult & { replayed: boolean };
export class D1PersonReceiptError extends Error {
  constructor(
    readonly code: "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_IN_PROGRESS",
  ) {
    super(code);
  }
}
export async function executeD1PersonEffect(args: {
  actor: AssistantProofActor;
  action: string;
  input: unknown;
  key: string | null;
  authorize: (db: D1ReadClient) => Promise<EffectResult | null>;
  plan: (
    db: D1ReadClient,
    receiptId: string | null,
  ) => Promise<NativePersonPlan>;
  sourceGuard?: AssistantSourceGuard;
  database?: D1Store;
  now?: Date;
}): Promise<NativePersonResult> {
  const store = args.database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    now = args.now ?? new Date(),
    hash = hashIdempotentRequest(args.action, args.input),
    scope = `user:${args.actor.userId}`;
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid person effect clock");
  for (let attempt = 0; attempt < 16; attempt++) {
    const captured = await captureD1Reads(
      async (db) => {
        const denied = await args.authorize(db);
        if (denied) return { reply: { ...denied, replayed: false } };
        const prior = args.key
          ? await db.idempotencyRecord.findUnique({
              where: { scope_key: { scope, key: args.key } },
            })
          : null;
        if (prior && prior.expires_at > now) {
          if (
            prior.family_id !== args.actor.familyId ||
            prior.user_id !== args.actor.userId ||
            prior.action !== args.action ||
            prior.request_hash !== hash
          )
            throw new D1PersonReceiptError("IDEMPOTENCY_KEY_REUSED");
          if (prior.response_status !== null)
            return {
              reply: {
                status: prior.response_status,
                body: prior.response_body,
                replayed: true,
              },
            };
          if (
            now.getTime() - prior.created_at.getTime() <
            IDEMPOTENCY_LOCK_TIMEOUT_MS
          )
            throw new D1PersonReceiptError("IDEMPOTENCY_IN_PROGRESS");
        }
        const recordId = args.key
          ? prior && prior.expires_at > now
            ? prior.id
            : randomUUID()
          : null;
        return { prior, recordId, plan: await args.plan(db, recordId) };
      },
      store as unknown as NativeD1,
    );
    try {
      if (captured.value.reply) {
        await session.batch(captured.checks(session));
        return captured.value.reply;
      }
      const { plan, prior, recordId } = captured.value,
        checks = captured.checks(session),
        successful = plan.status >= 200 && plan.status < 300;
      try {
        if (successful && args.sourceGuard) {
          const guard = args.sourceGuard;
          if (
            !guard.d1 ||
            !guard.actor ||
            guard.actor.userId !== args.actor.userId ||
            guard.actor.familyId !== args.actor.familyId ||
            guard.actor.role !== args.actor.role ||
            guard.actor.generation !== args.actor.generation
          )
            throw new AssistantSourceRefused();
          checks.push(
            ...(
              await d1AssistantSourceChecks(
                store,
                args.actor,
                guard.d1.kind,
                guard,
              )
            ).checks(session),
          );
        }
      } catch (cause) {
        // An exact concurrent retry may have changed its own Today projection.
        // Recover only the matching committed key; ordinary stale plans still fail.
        if (
          cause instanceof AssistantSourceRefused &&
          args.key &&
          (await session
            .prepare(
              "SELECT id FROM IdempotencyRecord WHERE scope=?1 AND key=?2 AND family_id=?3 AND action=?4 AND request_hash=?5 AND response_status IS NOT NULL AND expires_at>?6",
            )
            .bind(
              scope,
              args.key,
              args.actor.familyId,
              args.action,
              hash,
              now.getTime(),
            )
            .first())
        )
          continue;
        throw cause;
      }
      const effects: D1Statement[] = [];
      if (prior)
        effects.push(
          session
            .prepare("DELETE FROM IdempotencyRecord WHERE id=?1")
            .bind(prior.id),
        );
      effects.push(...(plan.effects?.(session) ?? []));
      if (successful && args.key && recordId)
        effects.push(
          session
            .prepare(
              "INSERT INTO IdempotencyRecord(id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            )
            .bind(
              recordId,
              scope,
              args.key,
              args.actor.familyId,
              args.actor.userId,
              args.action,
              hash,
              plan.status,
              JSON.stringify(plan.body),
              now.getTime(),
              now.getTime() + IDEMPOTENCY_TTL_MS,
            ),
        );
      await session.batch([...checks, ...effects]);
      return { status: plan.status, body: plan.body, replayed: false };
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new D1PersonReceiptError("IDEMPOTENCY_IN_PROGRESS");
}
