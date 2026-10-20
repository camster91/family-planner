/** Canonical parent future-routine coordinator. Not routed/activated yet. */
import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { choreAssigneeForCreateInTx } from "@/lib/chore-member-subject";
import { profileChoreAssigneeInTx } from "@/lib/chore-profile";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/profile-chore-gates";
import { hashIdempotentRequest, type EffectResult } from "@/lib/idempotency";
import {
  routineScheduleCommand,
  routineScheduleConfig,
  routineStepSeriesConfig,
  routineScheduleReceipt,
  normalizeRoutineSharedSchedule,
  firstRoutineOccurrence,
  planRoutineFutureRows,
  validateRoutineStepTransition,
  routineViewerDay,
  type RoutineScheduleCommand,
  type RoutineScheduleConfig,
  type RoutineStepSeriesConfig,
  type RoutineFutureSnapshot,
} from "@/lib/routine-schedule";
export const ROUTINE_SCHEDULE_ACTION = "routine.schedule.v1";
export const ROUTINE_SCHEDULE_WRITE_ENV = "ROUTINE_SCHEDULE_ENABLED";
export const ROUTINE_SCHEDULE_READY_ENV = "ROUTINE_SCHEDULE_ROLLBACK_READY";
export type RoutineScheduleActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
  memberProtocol?: 1 | 2;
};
type Db = Pick<PrismaClient, "$transaction">;
type Tx = Prisma.TransactionClient;
type Stack = {
  id: string;
  family_id: string;
  label: string;
  version: number;
  schedule_config: unknown;
};
type Root = {
  id: string;
  family_id: string;
  recurrence_id: string | null;
  routine_series_config: unknown;
  routine_stack_id: string | null;
};
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
const fail = (status: number, code: string): EffectResult => ({
  status,
  body: { error: { code } },
});
function refuse(status: number, code: string): never {
  throw new Refusal(status, code);
}
export async function routineScheduleAuthority(
  tx: Tx,
  actor: RoutineScheduleActor,
) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    refuse(401, "UNAUTHORIZED");
  if (user.family_id !== actor.familyId || user.role !== "parent")
    refuse(403, "ROUTINE_PARENT_REQUIRED");
  const family = await tx.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (
    !family ||
    !isFeatureEnabled(normalizeFeatures(family.features), "chores")
  )
    refuse(403, "CHORES_DISABLED");
  if (process.env[ROUTINE_SCHEDULE_READY_ENV] !== "1")
    refuse(404, "ROUTINE_SCHEDULE_UNAVAILABLE");
}
async function stackInTx(tx: Tx, familyId: string, id: string) {
  const rows = await tx.$queryRaw<
    Stack[]
  >`SELECT "id", "family_id", "label", "version", "schedule_config" FROM "RoutineStack" WHERE "id" = ${id} AND "family_id" = ${familyId} FOR UPDATE`;
  if (rows.length !== 1) refuse(404, "ROUTINE_SCHEDULE_UNAVAILABLE");
  const parsed = routineScheduleConfig.safeParse(rows[0].schedule_config);
  if (!parsed.success) refuse(409, "ROUTINE_SCHEDULE_UNSUPPORTED");
  return { row: rows[0], config: parsed.data };
}
async function rootsInTx(
  tx: Tx,
  actor: RoutineScheduleActor,
  stackId: string,
  config: RoutineScheduleConfig,
) {
  const roots: { row: Root; definition: RoutineStepSeriesConfig }[] = [];
  for (const step of [...config.steps].sort((a, b) =>
    a.template_id.localeCompare(b.template_id),
  )) {
    const rows = await tx.$queryRaw<
      Root[]
    >`SELECT "id", "family_id", "recurrence_id", "routine_stack_id", "routine_series_config" FROM "Chore" WHERE "id" = ${step.template_id} AND "family_id" = ${actor.familyId} FOR UPDATE`;
    if (rows.length !== 1 || rows[0].recurrence_id !== rows[0].id)
      refuse(409, "ROUTINE_ROOT_UNAVAILABLE");
    const parsed = routineStepSeriesConfig.safeParse(
      rows[0].routine_series_config,
    );
    if (
      !parsed.success ||
      parsed.data.stack_id !== stackId ||
      parsed.data.state !== config.state ||
      JSON.stringify(parsed.data.schedule) !==
        JSON.stringify(config.schedule) ||
      parsed.data.anchor !== config.anchor ||
      parsed.data.effective_on !== config.effective_on
    )
      refuse(409, "ROUTINE_DEFINITION_CONFLICT");
    roots.push({ row: rows[0], definition: parsed.data });
  }
  return roots;
}
async function subjectInTx(
  tx: Tx,
  actor: RoutineScheduleActor,
  subject: RoutineStepSeriesConfig["content"]["subject"],
  repeating: boolean,
) {
  if (subject.kind === "profile") {
    if (
      actor.memberProtocol !== 2 ||
      !isProfileChoreEnabled() ||
      (repeating && !isProfileChoreRecurrenceSupported())
    )
      refuse(409, "MEMBER_PROTOCOL_UNAVAILABLE");
    try {
      return await profileChoreAssigneeInTx(
        tx,
        actor.familyId,
        subject.member_id,
      );
    } catch {
      return refuse(409, "ROUTINE_SUBJECT_UNAVAILABLE");
    }
  }
  try {
    const owner = await choreAssigneeForCreateInTx(
      tx,
      actor.familyId,
      subject.user_id,
      { requireCanonical: subject.member_id !== null },
    );
    if (
      subject.member_id !== null &&
      owner.assigned_member_id !== subject.member_id
    )
      refuse(409, "ROUTINE_SUBJECT_UNAVAILABLE");
    return {
      assigned_to: owner.assigned_to,
      assigned_member_id: owner.assigned_member_id ?? null,
    };
  } catch (error) {
    if (error instanceof Refusal) throw error;
    return refuse(409, "ROUTINE_SUBJECT_UNAVAILABLE");
  }
}
function nextDay(day: string) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
async function partitionInTx(
  tx: Tx,
  actor: RoutineScheduleActor,
  stackId: string,
  roots: string[],
  viewDay: string,
) {
  const rows = await tx.chore.findMany({
    where: {
      family_id: actor.familyId,
      routine_stack_id: stackId,
      recurrence_id: { in: roots },
    },
    take: 10001,
    orderBy: { id: "asc" },
    select: {
      id: true,
      family_id: true,
      routine_stack_id: true,
      recurrence_id: true,
      is_template: true,
      due_date: true,
      status: true,
      photo_url: true,
      photo_verified: true,
      verified_at: true,
      verified_notes: true,
      completed_at: true,
      successor_id: true,
      member_subject_erased: true,
    },
  });
  if (rows.length > 10000) refuse(409, "ROUTINE_REVIEW_TOO_LARGE");
  const ids = rows.map((row) => row.id);
  if (ids.length)
    await tx.$queryRaw`SELECT "id" FROM "Chore" WHERE "id" = ANY(${ids}::text[]) AND "family_id" = ${actor.familyId} ORDER BY "id" FOR UPDATE`;
  // Re-read after row locks: a completion/upload outside the household lock
  // must not be mistaken for the earlier untouched pending snapshot.
  const current = await tx.chore.findMany({
    where: { id: { in: rows.map((row) => row.id) }, family_id: actor.familyId },
    select: {
      id: true,
      family_id: true,
      routine_stack_id: true,
      recurrence_id: true,
      is_template: true,
      due_date: true,
      status: true,
      photo_url: true,
      photo_verified: true,
      verified_at: true,
      verified_notes: true,
      completed_at: true,
      successor_id: true,
      member_subject_erased: true,
    },
  });
  if (current.length !== rows.length)
    refuse(409, "ROUTINE_OCCURRENCE_CONFLICT");
  const snapshots = current
    .map((row) => ({
      ...row,
      due_day: row.due_date.toISOString().slice(0, 10),
      verified_at: row.verified_at?.toISOString() ?? null,
      completed_at: row.completed_at?.toISOString() ?? null,
    }))
    .map(({ due_date: _date, ...row }) => row as RoutineFutureSnapshot);
  try {
    return planRoutineFutureRows({
      familyId: actor.familyId,
      stackId,
      templateIds: roots,
      viewDay,
      rows: snapshots,
    });
  } catch {
    return refuse(409, "ROUTINE_OCCURRENCE_CONFLICT");
  }
}
async function storeRootDefinition(
  tx: Tx,
  actor: RoutineScheduleActor,
  rootId: string,
  definition: RoutineStepSeriesConfig,
) {
  const value = routineStepSeriesConfig.parse(definition);
  const count =
    await tx.$executeRaw`UPDATE "Chore" SET "routine_series_config" = ${JSON.stringify(value)}::jsonb, "frequency" = ${value.schedule.frequency}, "weekly_days" = ${value.schedule.weekly_days}::integer[], "is_template" = ${value.state !== "stopped" && value.schedule.frequency !== "once"} WHERE "id" = ${rootId} AND "family_id" = ${actor.familyId} AND "recurrence_id" = ${rootId}`;
  if (count !== 1) refuse(409, "ROUTINE_ROOT_UNAVAILABLE");
}
async function storeStack(
  tx: Tx,
  actor: RoutineScheduleActor,
  id: string,
  version: number,
  label: string,
  config: RoutineScheduleConfig,
) {
  const value = routineScheduleConfig.parse(config);
  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify({ label, version, config: value }))
    .digest("hex");
  const count =
    await tx.$executeRaw`UPDATE "RoutineStack" SET "label" = ${label}, "version" = ${version}, "fingerprint" = ${fingerprint}, "schedule_config" = ${JSON.stringify(value)}::jsonb, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${id} AND "family_id" = ${actor.familyId}`;
  if (count !== 1) refuse(409, "ROUTINE_SCHEDULE_UNAVAILABLE");
}
/** Caller reserves a keyed record first; every effect and its proof commit together. */
export async function persistRoutineSchedule(
  db: Db,
  actor: RoutineScheduleActor,
  raw: RoutineScheduleCommand,
  recordId: string,
  now = new Date(),
): Promise<EffectResult> {
  const input = routineScheduleCommand.parse(raw);
  try {
    return await db.$transaction(
      async (tx) => {
        await routineScheduleAuthority(tx, actor);
        if (
          input.expected_user_id !== actor.userId ||
          input.expected_family_id !== actor.familyId
        )
          refuse(403, "AUTH_CONTEXT_CHANGED");
        await tx.$queryRaw`SELECT "id" FROM "IdempotencyRecord" WHERE "id" = ${recordId} FOR UPDATE`;
        const receipt = await tx.idempotencyRecord.findFirst({
          where: {
            id: recordId,
            scope: `user:${actor.userId}`,
            user_id: actor.userId,
            family_id: actor.familyId,
            action: ROUTINE_SCHEDULE_ACTION,
            request_hash: hashIdempotentRequest(ROUTINE_SCHEDULE_ACTION, input),
          },
          select: { response_status: true, response_body: true },
        });
        if (!receipt) refuse(409, "IDEMPOTENCY_IN_PROGRESS");
        if (receipt.response_status !== null) {
          const proof = routineScheduleReceipt.safeParse(receipt.response_body);
          if (
            receipt.response_status !==
              (input.action === "create" ? 201 : 200) ||
            !proof.success ||
            proof.data.requestId !== recordId ||
            proof.data.action !== input.action ||
            (input.action !== "create" && proof.data.stackId !== input.stack_id)
          )
            refuse(409, "ROUTINE_CONFIRMATION_UNAVAILABLE");
          const present = await tx.routineStack.findFirst({
            where: { id: proof.data.stackId, family_id: actor.familyId },
            select: { id: true },
          });
          if (
            !present ||
            (await tx.chore.count({
              where: {
                id: { in: proof.data.roots },
                family_id: actor.familyId,
              },
            })) !== proof.data.roots.length
          )
            refuse(409, "ROUTINE_ORIGINAL_REMOVED");
          return { status: receipt.response_status, body: proof.data };
        }
        if (process.env[ROUTINE_SCHEDULE_WRITE_ENV] !== "1")
          refuse(409, "ROUTINE_SCHEDULE_PAUSED");
        const age = now.getTime() - Date.parse(input.issued_at);
        if (
          age < -60000 ||
          age > 15 * 60_000 ||
          routineViewerDay(input.view_zone, now) !== input.view_day
        )
          refuse(409, "ROUTINE_INTENT_EXPIRED");
        const existing =
          input.action === "create"
            ? null
            : await stackInTx(tx, actor.familyId, input.stack_id);
        if (
          existing &&
          input.action !== "create" &&
          existing.row.version !== input.expected_version
        )
          refuse(409, "ROUTINE_VERSION_CONFLICT");
        if (existing?.config.state === "stopped")
          refuse(409, "ROUTINE_STOPPED");
        if (input.action === "replace-future") {
          try {
            validateRoutineStepTransition(existing!.config, input);
          } catch {
            refuse(409, "ROUTINE_STEPS_CHANGED");
          }
        }
        const priorRoots = existing
          ? await rootsInTx(tx, actor, existing.row.id, existing.config)
          : [];
        if (input.action === "resume" && existing!.config.state !== "paused")
          refuse(409, "ROUTINE_STATE_CONFLICT");
        if (input.action === "pause" && existing!.config.state !== "active")
          refuse(409, "ROUTINE_STATE_CONFLICT");
        const editing =
          input.action === "create" || input.action === "replace-future";
        const schedule = editing
          ? normalizeRoutineSharedSchedule(input.schedule, input.view_day)
          : existing!.config.schedule;
        if (input.action === "create" && schedule.starts_on! < input.view_day)
          refuse(400, "ROUTINE_START_IN_PAST");
        const candidates = editing
          ? input.steps
          : existing!.config.steps.map((step) => {
              const root = priorRoots.find(
                (candidate) => candidate.row.id === step.template_id,
              )!;
              return {
                ...root.definition.content,
                template_id: root.row.id,
                client_step_id: root.row.id,
              };
            });
        const assignments = new Map<
          string,
          { assigned_to: string | null; assigned_member_id: string | null }
        >();
        // All assignees are renewed before any data change. Pause/stop must remain
        // available when an old target has left; only fresh work needs eligibility.
        if (editing || input.action === "resume")
          for (const candidate of candidates)
            assignments.set(
              candidate.client_step_id,
              await subjectInTx(
                tx,
                actor,
                candidate.subject,
                schedule.frequency !== "once",
              ),
            );
        const stackId = existing?.row.id ?? crypto.randomUUID(),
          version = (existing?.row.version ?? 0) + 1;
        const state =
          input.action === "pause"
            ? "paused"
            : input.action === "stop"
              ? "stopped"
              : input.action === "resume"
                ? "active"
                : (existing?.config.state ?? "active");
        const effective =
          input.action === "create" ? input.view_day : nextDay(input.view_day);
        const anchor = editing ? input.anchor : existing!.config.anchor;
        const label = editing ? input.label : existing!.row.label;
        const partitions = new Map<
          string,
          Awaited<ReturnType<typeof partitionInTx>>
        >();
        let reviewedRows = 0;
        for (const root of priorRoots) {
          const partition = await partitionInTx(
            tx,
            actor,
            stackId,
            [root.row.id],
            input.view_day,
          );
          reviewedRows +=
            partition.pruneIds.length + partition.preserveIds.length;
          if (reviewedRows > 10000) refuse(409, "ROUTINE_REVIEW_TOO_LARGE");
          partitions.set(root.row.id, partition);
        }
        // From this point every refusal throws, rolling back all roots/config/copies.
        if (!existing)
          await tx.routineStack.create({
            data: {
              id: stackId,
              family_id: actor.familyId,
              label,
              version: 1,
              fingerprint: "pending",
              created_by: actor.userId,
            },
          });
        let prunedCount = 0,
          unstackedCount = 0;
        const removed =
          input.action === "replace-future" ? input.removed_steps : [];
        for (const root of priorRoots) {
          const partition = partitions.get(root.row.id)!;
          const removal = removed.find(
            (step) => step.template_id === root.row.id,
          );
          if (removal?.disposition === "unstack-future") {
            const update = await tx.chore.updateMany({
              where: {
                id: { in: partition.pruneIds },
                family_id: actor.familyId,
                routine_stack_id: stackId,
              },
              data: {
                routine_stack_id: null,
                routine: null,
                routine_order: null,
              },
            });
            if (update.count !== partition.pruneIds.length)
              refuse(409, "ROUTINE_OCCURRENCE_CONFLICT");
            unstackedCount += update.count;
            await storeRootDefinition(tx, actor, root.row.id, {
              ...root.definition,
              stack_id: null,
              state: "active",
              effective_on: effective,
            });
          } else {
            const deletion = await tx.chore.deleteMany({
              where: {
                id: { in: partition.pruneIds },
                family_id: actor.familyId,
                routine_stack_id: stackId,
              },
            });
            if (deletion.count !== partition.pruneIds.length)
              refuse(409, "ROUTINE_OCCURRENCE_CONFLICT");
            prunedCount += deletion.count;
            if (removal)
              await storeRootDefinition(tx, actor, root.row.id, {
                ...root.definition,
                stack_id: null,
                state: "stopped",
                effective_on: effective,
              });
          }
        }
        const roots: string[] = [];
        for (const [index, candidate] of candidates.entries()) {
          const rootId = candidate.template_id ?? crypto.randomUUID();
          roots.push(rootId);
          const {
            client_step_id: _client,
            template_id: _template,
            ...content
          } = candidate;
          const definition = routineStepSeriesConfig.parse({
            protocol: "herewoven.routine-step-series.v1",
            stack_id: stackId,
            state,
            effective_on: effective,
            anchor,
            schedule,
            content,
          });
          if (!candidate.template_id) {
            const owner = assignments.get(candidate.client_step_id)!;
            const dueDay = firstRoutineOccurrence(
              schedule,
              input.view_day,
              effective,
            );
            await tx.chore.create({
              data: {
                id: rootId,
                family_id: actor.familyId,
                created_by: actor.userId,
                ...owner,
                title: content.title,
                description: content.description,
                points: content.points,
                difficulty: content.difficulty,
                icon: content.icon,
                due_date: new Date(`${dueDay}T00:00:00.000Z`),
                frequency: schedule.frequency,
                weekly_days: schedule.weekly_days,
                recurrence_id: rootId,
                is_template: schedule.frequency !== "once",
                routine_stack_id: stackId,
                routine: label,
                routine_order: index + 1,
              },
            });
            await tx.$executeRaw`UPDATE "Chore" SET "routine_anchor" = ${anchor}, "routine_duration_minutes" = ${content.duration_minutes} WHERE "id" = ${rootId} AND "family_id" = ${actor.familyId}`;
          }
          await storeRootDefinition(tx, actor, rootId, definition);
        }
        const config = routineScheduleConfig.parse({
          protocol: input.protocol,
          state,
          effective_on: effective,
          anchor,
          schedule,
          steps: roots.map((template_id) => ({ template_id })),
        });
        await storeStack(tx, actor, stackId, version, label, config);
        const proof = routineScheduleReceipt.parse({
          protocol: input.protocol,
          requestId: recordId,
          stackId,
          version,
          action: input.action,
          state,
          roots,
          prunedCount,
          unstackedCount,
        });
        const status = input.action === "create" ? 201 : 200;
        await tx.idempotencyRecord.update({
          where: { id: recordId },
          data: {
            response_status: status,
            response_body: proof as Prisma.InputJsonObject,
          },
        });
        return { status, body: proof };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof Refusal) return fail(error.status, error.code);
    throw error;
  }
}
/** Private original-parent read, available while fresh writing is paused. */
export async function readRoutineSchedule(
  db: Db,
  actor: RoutineScheduleActor,
  stackId: string,
): Promise<EffectResult> {
  try {
    return await db.$transaction(async (tx) => {
      await routineScheduleAuthority(tx, actor);
      const stack = await stackInTx(tx, actor.familyId, stackId),
        roots = await rootsInTx(tx, actor, stackId, stack.config);
      const byId = new Map(
        roots.map((root) => [root.row.id, root.definition.content]),
      );
      return {
        status: 200,
        body: {
          protocol: stack.config.protocol,
          userId: actor.userId,
          familyId: actor.familyId,
          stackId,
          version: stack.row.version,
          label: stack.row.label,
          config: stack.config,
          steps: stack.config.steps.map((step) => ({
            template_id: step.template_id,
            ...byId.get(step.template_id)!,
          })),
        },
      };
    });
  } catch (error) {
    if (error instanceof Refusal) return fail(error.status, error.code);
    throw error;
  }
}
