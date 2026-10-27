import {
  independentRecoveryEntry,
  independentRecoveryReview,
  INDEPENDENT_RECOVERY_CONTRACT,
  type IndependentRecoveryEntry,
  type IndependentRecoveryReview,
} from "@/lib/routine-independent-recovery";
/** Canonical detached-step effects. No route/client activation in this module. */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_TTL_MS,
  type EffectResult,
} from "@/lib/idempotency";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import {
  routineStepSeriesConfig,
  normalizeRoutineSharedSchedule,
  routineViewerDay,
  type RoutineStepSeriesConfig,
} from "@/lib/routine-schedule";
import {
  routineIndependentCatalog,
  routineIndependentCommand,
  routineIndependentReceipt,
  routineIndependentState,
  ROUTINE_INDEPENDENT_PROTOCOL,
  type RoutineIndependentCommand,
} from "@/lib/routine-independent";
import {
  routineScheduleAuthority,
  routineScheduleFailure,
  routineScheduleSubjectInTx,
  partitionRoutineFutureInTx,
  storeRoutineRootDefinition,
  ROUTINE_SCHEDULE_WRITE_ENV,
  type RoutineScheduleActor,
} from "@/lib/routine-schedule-runtime";
import { routineOccurrencePolicyInTx } from "@/lib/routine-occurrence-policy";
import { expandSeriesInTx } from "@/lib/recurringChores";
export const ROUTINE_INDEPENDENT_ACTION = "routine.independent.v1";
type Tx = Prisma.TransactionClient;
type Db = Pick<PrismaClient, "$transaction">;
class IndependentRefusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function refuse(status: number, code: string): never {
  throw new IndependentRefusal(status, code);
}
export function routineIndependentFailure(
  caught: unknown,
): EffectResult | null {
  return caught instanceof IndependentRefusal
    ? { status: caught.status, body: { error: { code: caught.code } } }
    : routineScheduleFailure(caught);
}
async function rootInTx(tx: Tx, familyId: string, rootId: string) {
  const rows = await tx.$queryRaw<
    {
      id: string;
      recurrence_id: string | null;
      due_date: Date;
      member_subject_erased: boolean;
      routine_series_config: unknown;
    }[]
  >`
    SELECT "id", "recurrence_id", "due_date", "member_subject_erased", "routine_series_config"
    FROM "Chore" WHERE "id" = ${rootId} AND "family_id" = ${familyId} FOR UPDATE`;
  const row = rows[0];
  if (rows.length !== 1 || !row || row.recurrence_id !== row.id)
    refuse(404, "ROUTINE_ROOT_UNAVAILABLE");
  const parsed = routineStepSeriesConfig.safeParse(row.routine_series_config);
  if (!parsed.success) refuse(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
  if (parsed.data.stack_id !== null) refuse(409, "ROUTINE_STEP_ATTACHED");
  return { row, definition: parsed.data };
}
export function assertIndependentIntent(
  input: RoutineIndependentCommand,
  definition: RoutineStepSeriesConfig,
  now: Date,
) {
  const age = now.getTime() - Date.parse(input.issued_at);
  if (
    age < -60000 ||
    age > 15 * 60000 ||
    routineViewerDay(input.view_zone, now) !== input.view_day
  )
    refuse(409, "ROUTINE_INTENT_EXPIRED");
  if (definition.stack_id !== null) refuse(409, "ROUTINE_STEP_ATTACHED");
  if (definition.revision !== input.expected_revision)
    refuse(409, "ROUTINE_VERSION_CONFLICT");
  if (definition.state === "stopped") refuse(409, "ROUTINE_STOPPED");
  if (
    (input.action === "pause" && definition.state !== "active") ||
    (input.action === "resume" && definition.state !== "paused")
  )
    refuse(409, "ROUTINE_STATE_CONFLICT");
  if (
    input.action === "resume" &&
    definition.schedule.frequency === "once" &&
    definition.schedule.starts_on! <= input.view_day
  )
    refuse(409, "ROUTINE_ONCE_ALREADY_PASSED");
}
/** Atomic key reservation/effect/proof. A late retry confirms, never rebases. */
export async function saveIndependentRoutineStep(
  db: Db,
  actor: RoutineScheduleActor,
  raw: unknown,
  key: string,
  now = new Date(),
  writesEnabled = true,
): Promise<EffectResult> {
  const input = routineIndependentCommand.parse(raw);
  if (!isValidIdempotencyKey(key))
    return {
      status: 400,
      body: { error: { code: "IDEMPOTENCY_KEY_INVALID" } },
    };
  try {
    return await db.$transaction(
      async (tx) => {
        const capabilities = await routineScheduleAuthority(tx, actor);
        if (
          input.expected_user_id !== actor.userId ||
          input.expected_family_id !== actor.familyId
        )
          refuse(403, "AUTH_CONTEXT_CHANGED");
        const scope = `user:${actor.userId}`,
          requestHash = hashIdempotentRequest(
            ROUTINE_INDEPENDENT_ACTION,
            input,
          );
        let record = await tx.idempotencyRecord.findUnique({
          where: { scope_key: { scope, key } },
        });
        if (
          record &&
          (record.user_id !== actor.userId ||
            record.family_id !== actor.familyId ||
            record.action !== ROUTINE_INDEPENDENT_ACTION ||
            record.request_hash !== requestHash)
        )
          refuse(422, "IDEMPOTENCY_KEY_REUSED");
        // Actor/household locks precede the receipt, matching deletion and schedule writes.
        if (record)
          await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${record.id} FOR UPDATE`;
        if (record?.response_status != null) {
          const proof = routineIndependentReceipt.safeParse(
            record.response_body,
          );
          if (
            record.response_status !== 200 ||
            !proof.success ||
            proof.data.requestId !== record.id ||
            proof.data.rootId !== input.root_id ||
            proof.data.action !== input.action ||
            proof.data.revision !== input.expected_revision + 1
          )
            refuse(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
          const present = await tx.chore.findFirst({
            where: {
              id: input.root_id,
              family_id: actor.familyId,
              recurrence_id: input.root_id,
            },
            select: { id: true },
          });
          if (!present) refuse(409, "ROUTINE_ORIGINAL_REMOVED");
          return { status: 200, body: proof.data };
        }
        if (!writesEnabled || process.env[ROUTINE_SCHEDULE_WRITE_ENV] !== "1")
          refuse(409, "ROUTINE_WRITES_PAUSED");
        const original = await rootInTx(tx, actor.familyId, input.root_id);
        assertIndependentIntent(input, original.definition, now);
        const effective = new Date(`${input.view_day}T00:00:00.000Z`);
        effective.setUTCDate(effective.getUTCDate() + 1);
        const effectiveDay = effective.toISOString().slice(0, 10);
        const editing = input.action === "replace-future";
        const schedule = editing
          ? normalizeRoutineSharedSchedule(input.schedule, input.view_day)
          : original.definition.schedule;
        const content = editing
          ? {
              ...input.content,
              points:
                !capabilities.pointsEnabled || input.content.points === null
                  ? original.definition.content.points
                  : input.content.points,
            }
          : original.definition.content;
        // Pause/stop remain available if the original assignee has since left.
        if (editing || input.action === "resume")
          await routineScheduleSubjectInTx(
            tx,
            actor,
            content.subject,
            schedule.frequency !== "once",
          );
        const retired =
          original.definition.anchor_retired ||
          (original.row.due_date.toISOString().slice(0, 10) < effectiveDay &&
            (await routineOccurrencePolicyInTx(
              tx,
              actor.familyId,
              input.root_id,
            )) === "inactive");
        const definition = routineStepSeriesConfig.parse({
          ...original.definition,
          revision: original.definition.revision + 1,
          state:
            input.action === "pause"
              ? "paused"
              : input.action === "resume"
                ? "active"
                : input.action === "stop"
                  ? "stopped"
                  : original.definition.state,
          effective_on: effectiveDay,
          anchor_retired: retired,
          anchor: editing ? input.anchor : original.definition.anchor,
          schedule,
          content,
        });
        // Only detached untouched future copies are replaceable. Attached evidence,
        // root control anchors, started work and history are never moved/deleted.
        const partition = await partitionRoutineFutureInTx(
          tx,
          actor,
          null,
          [input.root_id],
          input.view_day,
        );
        if (!record)
          record = await tx.idempotencyRecord.create({
            data: {
              scope,
              key,
              user_id: actor.userId,
              family_id: actor.familyId,
              action: ROUTINE_INDEPENDENT_ACTION,
              request_hash: requestHash,
              expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
            },
          });
        const deleted = await tx.chore.deleteMany({
          where: {
            id: { in: partition.pruneIds },
            family_id: actor.familyId,
            recurrence_id: input.root_id,
            routine_stack_id: null,
          },
        });
        if (deleted.count !== partition.pruneIds.length)
          refuse(409, "ROUTINE_OCCURRENCE_CONFLICT");
        await storeRoutineRootDefinition(tx, actor, input.root_id, definition);
        if (definition.state === "active")
          await expandSeriesInTx(tx, input.root_id, actor.familyId, now);
        const proof = routineIndependentReceipt.parse({
          protocol: ROUTINE_INDEPENDENT_PROTOCOL,
          requestId: record.id,
          rootId: input.root_id,
          revision: definition.revision,
          action: input.action,
          state: definition.state,
          prunedCount: deleted.count,
        });
        await tx.idempotencyRecord.update({
          where: { id: record.id },
          data: {
            response_status: 200,
            response_body: proof as Prisma.InputJsonObject,
          },
        });
        return { status: 200, body: proof };
      },
      { timeout: 30000 },
    );
  } catch (caught) {
    const failure = routineIndependentFailure(caught);
    if (failure) return failure;
    throw caught;
  }
}
/** Private parent read; zero points payload when the household disabled points. */
export async function readIndependentRoutineStep(
  db: Db,
  actor: RoutineScheduleActor,
  rootId: string,
): Promise<EffectResult> {
  try {
    return await db.$transaction(async (tx) => {
      const capabilities = await routineScheduleAuthority(tx, actor);
      const { definition } = await rootInTx(tx, actor.familyId, rootId);
      const { points, ...content } = definition.content;
      return {
        status: 200,
        body: routineIndependentState.parse({
          protocol: ROUTINE_INDEPENDENT_PROTOCOL,
          userId: actor.userId,
          familyId: actor.familyId,
          rootId,
          revision: definition.revision,
          state: definition.state,
          effectiveOn: definition.effective_on,
          anchor: definition.anchor,
          schedule: definition.schedule,
          pointsEnabled: capabilities.pointsEnabled,
          content: {
            ...content,
            subject:
              definition.content.subject.kind === "erased"
                ? null
                : definition.content.subject,
            ...(capabilities.pointsEnabled ? { points } : {}),
          },
        }),
      };
    });
  } catch (caught) {
    const failure = routineIndependentFailure(caught);
    if (failure) return failure;
    throw caught;
  }
}

/** Independent canonical roots only; generated copies and legacy rows stay separate. */
export async function readIndependentRoutineCatalog(
  db: Db,
  actor: RoutineScheduleActor,
  cursor: string | null,
): Promise<EffectResult> {
  if (cursor !== null && (!cursor || cursor.length > 128))
    return { status: 400, body: { error: { code: "INVALID_QUERY" } } };
  try {
    return await db.$transaction(async (tx) => {
      await routineScheduleAuthority(tx, actor);
      const rows = await tx.$queryRaw<
        { id: string; title: string; routine_series_config: unknown }[]
      >`
        SELECT "id", "title", "routine_series_config" FROM "Chore"
        WHERE "family_id" = ${actor.familyId} AND "recurrence_id" = "id"
          AND "routine_series_config" IS NOT NULL
          AND "routine_series_config"->>'stack_id' IS NULL AND "id" > ${cursor ?? ""}
        ORDER BY "id" ASC LIMIT 21`;
      const page = rows.slice(0, 20);
      return {
        status: 200,
        body: routineIndependentCatalog.parse({
          protocol: ROUTINE_INDEPENDENT_PROTOCOL,
          userId: actor.userId,
          familyId: actor.familyId,
          steps: page.map((row) => {
            const parsed = routineStepSeriesConfig.safeParse(
              row.routine_series_config,
            );
            const definition =
              parsed.success && parsed.data.stack_id === null
                ? parsed.data
                : null;
            return {
              rootId: row.id,
              title: definition?.content.title ?? row.title,
              revision: definition?.revision ?? null,
              state: definition?.state ?? "unsupported",
              schedule: definition?.schedule ?? null,
            };
          }),
          nextCursor: rows.length > 20 ? page.at(-1)!.id : null,
        }),
      };
    });
  } catch (caught) {
    const failure = routineIndependentFailure(caught);
    if (failure) return failure;
    throw caught;
  }
}

/** Read-only exact-key result review; never reserves, mutates or rebases intent. */
export async function reviewIndependentRoutineStep(
  db: Db,
  actor: RoutineScheduleActor,
  raw: IndependentRecoveryEntry,
  ownerScope: string,
  writesEnabled: boolean,
  now = new Date(),
): Promise<EffectResult> {
  const capturedActor = Object.freeze({ ...actor });
  const entry = independentRecoveryEntry.parse(raw),
    input = routineIndependentCommand.parse(JSON.parse(entry.body));
  try {
    return await db.$transaction(async (tx) => {
      await routineScheduleAuthority(tx, capturedActor);
      if (
        input.expected_user_id !== capturedActor.userId ||
        input.expected_family_id !== capturedActor.familyId
      )
        refuse(403, "AUTH_CONTEXT_CHANGED");
      const record = await tx.idempotencyRecord.findUnique({
        where: { scope_key: { scope: `user:${capturedActor.userId}`, key: entry.key } },
      });
      if (
        record &&
        (record.user_id !== capturedActor.userId ||
          record.family_id !== capturedActor.familyId ||
          record.action !== ROUTINE_INDEPENDENT_ACTION ||
          record.request_hash !==
            hashIdempotentRequest(ROUTINE_INDEPENDENT_ACTION, input))
      )
        refuse(422, "IDEMPOTENCY_KEY_REUSED");
      const rows = await tx.$queryRaw<
        {
          id: string;
          recurrence_id: string | null;
          member_subject_erased: boolean;
          routine_series_config: unknown;
        }[]
      >`
        SELECT "id", "recurrence_id", "member_subject_erased", "routine_series_config" FROM "Chore"
        WHERE "id" = ${input.root_id} AND "family_id" = ${capturedActor.familyId}`;
      const row = rows[0],
        parsed = routineStepSeriesConfig.safeParse(row?.routine_series_config);
      const current =
        rows.length === 1 &&
        row.recurrence_id === row.id &&
        parsed.success &&
        parsed.data.stack_id === null
          ? parsed.data
          : null;
      async function reply(
        state: IndependentRecoveryReview["state"],
        receipt: unknown = null,
      ): Promise<EffectResult> {
        // Saved packets/proof are private even when this review makes no write.
        await routineScheduleAuthority(tx, capturedActor);
        return {
          status: 200,
          body: independentRecoveryReview.parse({
            contract: INDEPENDENT_RECOVERY_CONTRACT,
            ownerScope,
            entry,
            state,
            canRetry: state === "ready" || state === "pending",
            currentRevision: current?.revision ?? null,
            receipt,
          }),
        };
      }
      if (record?.response_status != null) {
        const proof = routineIndependentReceipt.safeParse(record.response_body);
        if (
          record.response_status !== 200 ||
          !proof.success ||
          proof.data.requestId !== record.id ||
          proof.data.rootId !== input.root_id ||
          proof.data.action !== input.action ||
          proof.data.revision !== input.expected_revision + 1
        )
          return reply("unavailable");
        return reply(
          rows.length === 1 && row.recurrence_id === row.id
            ? "committed"
            : "removed",
          proof.data,
        );
      }
      const age = now.getTime() - Date.parse(input.issued_at);
      if (
        age < -60000 ||
        age > 15 * 60000 ||
        routineViewerDay(input.view_zone, now) !== input.view_day
      )
        return reply("expired");
      if (!current) return reply("unavailable");
      try {
        assertIndependentIntent(input, current, now);
      } catch (caught) {
        if (routineIndependentFailure(caught)) return reply("conflict");
        throw caught;
      }
      if (!writesEnabled || process.env[ROUTINE_SCHEDULE_WRITE_ENV] !== "1")
        return reply("paused");
      return reply(record ? "pending" : "ready");
    });
  } catch (caught) {
    const failure = routineIndependentFailure(caught);
    if (failure) return failure;
    throw caught;
  }
}
