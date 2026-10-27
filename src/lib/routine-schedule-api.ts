/** Key reservation, canonical effect and proof share one transaction. No generic takeover. */
import type { PrismaClient } from "@prisma/client";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_TTL_MS,
  type EffectResult,
} from "@/lib/idempotency";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import {
  routineScheduleCommand,
  routineScheduleConfig,
  routineScheduleReceipt,
  routineViewerDay,
} from "@/lib/routine-schedule";
import {
  ROUTINE_SCHEDULE_ACTION,
  routineScheduleAuthority,
  persistRoutineScheduleInTx,
  routineScheduleFailure,
  type RoutineScheduleActor,
} from "@/lib/routine-schedule-runtime";
import {
  routineRecoveryReview,
  routineRecoveryEntry,
  ROUTINE_RECOVERY_CONTRACT,
  type RoutineRecoveryEntry,
} from "@/lib/routine-schedule-recovery-contract";
type Db = Pick<PrismaClient, "$transaction">;
const error = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
class BoundaryRefusal extends Error {
  constructor(readonly result: EffectResult) {
    super("Routine request refused");
  }
}
function failure(caught: unknown) {
  return caught instanceof BoundaryRefusal
    ? caught.result
    : routineScheduleFailure(caught);
}
export async function saveRoutineSchedule(
  db: Db,
  actor: RoutineScheduleActor,
  raw: unknown,
  key: string,
  now = new Date(),
  writesEnabled = true,
): Promise<EffectResult> {
  const input = routineScheduleCommand.parse(raw);
  if (!isValidIdempotencyKey(key)) return error(400, "IDEMPOTENCY_KEY_INVALID");
  try {
    return await db.$transaction(
      async (tx) => {
        await routineScheduleAuthority(tx, actor);
        if (
          input.expected_user_id !== actor.userId ||
          input.expected_family_id !== actor.familyId
        )
          throw new BoundaryRefusal(error(403, "AUTH_CONTEXT_CHANGED"));
        const scope = `user:${actor.userId}`,
          requestHash = hashIdempotentRequest(ROUTINE_SCHEDULE_ACTION, input);
        let record = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key } },
        });
        // Retain an old proof, including beyond nominal TTL. Never delete/reuse a
        // schedule key here: late confirmation cannot turn into a second create.
        if (
          record &&
          (record.family_id !== actor.familyId ||
            record.user_id !== actor.userId ||
            record.action !== ROUTINE_SCHEDULE_ACTION ||
            record.request_hash !== requestHash)
        )
          throw new BoundaryRefusal(error(422, "IDEMPOTENCY_KEY_REUSED"));
        if (record?.response_status == null && !writesEnabled)
          throw new BoundaryRefusal(error(409, "ROUTINE_WRITES_PAUSED"));
        if (!record)
          record = await tx.idempotencyRecord.create({
            data: {
              scope,
              key,
              family_id: actor.familyId,
              user_id: actor.userId,
              action: ROUTINE_SCHEDULE_ACTION,
              request_hash: requestHash,
              expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
            },
          });
        return persistRoutineScheduleInTx(tx, actor, input, record.id, now);
      },
      { timeout: 30_000 },
    );
  } catch (caught) {
    const result = failure(caught);
    if (result) return result;
    throw caught;
  }
}
/** Read only. Original bytes/key are echoed solely to their authenticated parent. */
export async function reviewRoutineSchedule(
  db: Db,
  actor: RoutineScheduleActor,
  raw: RoutineRecoveryEntry,
  ownerScope: string,
  writesEnabled: boolean,
  now = new Date(),
): Promise<EffectResult> {
  const capturedActor = Object.freeze({ ...actor });
  const entry = routineRecoveryEntry.parse(raw),
    input = routineScheduleCommand.parse(JSON.parse(entry.body));
  try {
    return await db.$transaction(async (tx) => {
      await routineScheduleAuthority(tx, capturedActor);
      if (
        input.expected_user_id !== capturedActor.userId ||
        input.expected_family_id !== capturedActor.familyId
      )
        throw new BoundaryRefusal(error(403, "AUTH_CONTEXT_CHANGED"));
      const record = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope: `user:${capturedActor.userId}`, key: entry.key } },
      });
      if (
        record &&
        (record.family_id !== capturedActor.familyId ||
          record.user_id !== capturedActor.userId ||
          record.action !== ROUTINE_SCHEDULE_ACTION ||
          record.request_hash !==
            hashIdempotentRequest(ROUTINE_SCHEDULE_ACTION, input))
      )
        throw new BoundaryRefusal(error(422, "IDEMPOTENCY_KEY_REUSED"));
      const stackId = input.action === "create" ? null : input.stack_id;
      const current = stackId
        ? await tx.routineStack.findFirst({
            where: { id: stackId, family_id: capturedActor.familyId },
            select: { version: true },
          })
        : null;
      async function reply(
        state: RoutineRecoveryReviewState,
        receipt: unknown = null,
      ): Promise<EffectResult> {
        // Saved packets/proof are private even when this review makes no write.
        await routineScheduleAuthority(tx, capturedActor);
        return {
          status: 200,
          body: routineRecoveryReview.parse({
            contract: ROUTINE_RECOVERY_CONTRACT,
            ownerScope,
            entry,
            state,
            canRetry: state === "ready" || state === "pending",
            currentVersion: current?.version ?? null,
            receipt,
          }),
        };
      }
      if (
        record?.response_status !== null &&
        record?.response_status !== undefined
      ) {
        const proof = routineScheduleReceipt.safeParse(record.response_body);
        if (
          !proof.success ||
          record.response_status !== (input.action === "create" ? 201 : 200) ||
          proof.data.requestId !== record.id ||
          proof.data.action !== input.action ||
          (input.action !== "create" && proof.data.stackId !== input.stack_id)
        )
          return reply("unavailable");
        const present = await tx.routineStack.findFirst({
          where: { id: proof.data.stackId, family_id: capturedActor.familyId },
          select: { id: true },
        });
        const roots = await tx.chore.count({
          where: { id: { in: proof.data.roots }, family_id: capturedActor.familyId },
        });
        return reply(
          present && roots === proof.data.roots.length
            ? "committed"
            : "removed",
          proof.data,
        );
      }
      const age = now.getTime() - Date.parse(input.issued_at);
      if (
        age > 15 * 60_000 ||
        age < -60_000 ||
        routineViewerDay(input.view_zone, now) !== input.view_day
      )
        return reply("expired");
      if (stackId) {
        if (!current) return reply("conflict");
        if (
          input.action !== "create" &&
          current.version !== input.expected_version
        )
          return reply("conflict");
        const definitions = await tx.$queryRaw<
          { schedule_config: unknown }[]
        >`SELECT "schedule_config" FROM "RoutineStack" WHERE "id" = ${stackId} AND "family_id" = ${capturedActor.familyId}`;
        const parsed = routineScheduleConfig.safeParse(
          definitions[0]?.schedule_config,
        );
        if (!parsed.success || parsed.data.state === "stopped")
          return reply("unavailable");
        if (
          (input.action === "pause" && parsed.data.state !== "active") ||
          (input.action === "resume" &&
            (parsed.data.state !== "paused" ||
              (parsed.data.schedule.frequency === "once" &&
                parsed.data.schedule.starts_on! <= input.view_day)))
        )
          return reply("conflict");
      }
      if (
        input.action === "create" &&
        input.schedule.starts_on !== null &&
        input.schedule.starts_on < input.view_day
      )
        return reply("conflict");
      if (!writesEnabled) return reply("paused");
      return reply(record ? "pending" : "ready");
    });
  } catch (caught) {
    const result = failure(caught);
    if (result) return result;
    throw caught;
  }
}
type RoutineRecoveryReviewState =
  | "ready"
  | "pending"
  | "committed"
  | "removed"
  | "expired"
  | "conflict"
  | "paused"
  | "unavailable";
