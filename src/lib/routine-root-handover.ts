/** Future control identity survives erasure without preserving personal chore rows. */
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { hasRoutineSubjectStorage } from "@/lib/routine-subject-lifecycle";
import {
  routineScheduleConfig,
  routineStepSeriesConfig,
} from "@/lib/routine-schedule";
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/** Rewrite only exact known root identity slots, preserving author order/protocol. */
export function replaceRoutineControlRoots(
  raw: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown | null {
  const record = object(raw);
  if (!record || !Array.isArray(record.steps)) return null;
  let changed = false;
  const steps = record.steps.map((value) => {
    const step = object(value),
      next =
        typeof step?.template_id === "string"
          ? replacements.get(step.template_id)
          : undefined;
    if (!step || !next) return value;
    changed = true;
    return { ...step, template_id: next };
  });
  if (!changed) return null;
  const updated = { ...record, steps },
    known = routineScheduleConfig.safeParse(raw);
  return known.success ? routineScheduleConfig.parse(updated) : updated;
}
/** Caller holds deleting account + every relevant household lock; no fresh assignment. */
export async function handOverRoutineControlRootsInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  departingUserId: string,
  successorId: string,
): Promise<Map<string, string>> {
  const replacements = new Map<string, string>();
  if (!(await hasRoutineSubjectStorage(tx))) return replacements;
  const successor = await tx.user.findFirst({
    where: { id: successorId, family_id: familyId },
    select: { id: true },
  });
  if (!successor || successor.id === departingUserId)
    throw new Error("Routine control successor unavailable");
  const roots = await tx.$queryRaw<
    { id: string; due_date: Date; routine_series_config: unknown }[]
  >`
    SELECT "id", "due_date", "routine_series_config" FROM "Chore"
    WHERE "family_id" = ${familyId} AND "assigned_to" = ${departingUserId}
      AND "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
    ORDER BY "id" FOR UPDATE`;
  for (const root of roots) {
    const parsed = routineStepSeriesConfig.safeParse(
      root.routine_series_config,
    );
    const definition = parsed.success
      ? routineStepSeriesConfig.parse({
          ...parsed.data,
          revision: Math.min(2147483647, parsed.data.revision + 1),
          anchor_retired: true,
        })
      : null;
    const oldest = await tx.chore.findFirst({
      where: { family_id: familyId, recurrence_id: root.id },
      orderBy: [{ due_date: "asc" }, { id: "asc" }],
      select: { due_date: true },
    });
    if (!oldest) throw new Error("Routine control lineage unavailable");
    // This is an invisible control date, not a task due date. Keep it outside
    // all retained occurrence slots so the retired control cannot occupy and
    // suppress a genuinely scheduled day after the old personal root is gone.
    const controlDate = new Date(oldest.due_date.getTime() - 86400000);
    if (!Number.isFinite(controlDate.getTime()))
      throw new Error("Routine control date unavailable");
    const newId = crypto.randomUUID();
    // A control carries no old assignee, proof, completion, picture, XP, or
    // personal snapshot. Its private future definition is the retained plan.
    // Erasure already redacted the departing person's future subject IDs.
    await tx.chore.create({
      data: {
        id: newId,
        family_id: familyId,
        created_by: successorId,
        assigned_to: null,
        assigned_member_id: null,
        member_subject_erased: true,
        title: definition?.content.title ?? "Routine step",
        description: null,
        points: 0,
        difficulty: definition?.content.difficulty ?? "medium",
        icon: definition?.content.icon ?? null,
        due_date: controlDate,
        status: "pending",
        recurrence_id: newId,
        is_template:
          !!definition &&
          definition.state !== "stopped" &&
          definition.schedule.frequency !== "once",
        frequency: definition?.schedule.frequency ?? "once",
        weekly_days: definition?.schedule.weekly_days ?? [],
        routine_stack_id: null,
        routine: null,
        routine_order: null,
      },
    });
    const written =
      await tx.$executeRaw`UPDATE "Chore" SET "routine_series_config" = ${JSON.stringify(definition ?? root.routine_series_config)}::jsonb WHERE "id" = ${newId} AND "family_id" = ${familyId}`;
    if (written !== 1) throw new Error("Routine control handover failed");
    // recurrence_id is control lineage only. Do not alter occurrence IDs,
    // subject aliases, status, creator, evidence, assignment rows or earned XP.
    // The control date precedes every retained slot; no occurrence is moved.
    await tx.chore.updateMany({
      where: {
        family_id: familyId,
        recurrence_id: root.id,
        id: { not: root.id },
      },
      data: { recurrence_id: newId },
    });
    replacements.set(root.id, newId);
  }
  if (replacements.size === 0) return replacements;
  const stackStorage = await tx.$queryRaw<
    { present: boolean }[]
  >`SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"RoutineStack"') AND attname = 'schedule_config' AND NOT attisdropped) AS present`;
  if (stackStorage.length !== 1 || stackStorage[0].present !== true)
    return replacements;
  // Include any owning config with an exact root reference. This also preserves
  // an unsupported config without interpreting it as a supported schedule.
  const stacks = await tx.$queryRaw<
    { id: string; label: string; version: number; schedule_config: unknown }[]
  >`
    SELECT "id", "label", "version", "schedule_config" FROM "RoutineStack"
    WHERE "family_id" = ${familyId} AND "schedule_config" IS NOT NULL
    ORDER BY "id" FOR UPDATE`;
  for (const stack of stacks) {
    const config = replaceRoutineControlRoots(
      stack.schedule_config,
      replacements,
    );
    if (!config) continue;
    const version = Math.min(2147483647, stack.version + 1);
    const fingerprint = crypto
      .createHash("sha256")
      .update(JSON.stringify({ label: stack.label, version, config }))
      .digest("hex");
    const written =
      await tx.$executeRaw`UPDATE "RoutineStack" SET "version" = ${version}, "fingerprint" = ${fingerprint}, "schedule_config" = ${JSON.stringify(config)}::jsonb, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${stack.id} AND "family_id" = ${familyId}`;
    if (written !== 1) throw new Error("Routine stack handover failed");
  }
  return replacements;
}
