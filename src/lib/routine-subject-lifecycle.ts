/** Routine future subjects participate in existing locked identity transactions. */
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  routineStepSeriesConfig,
  routineScheduleConfig,
} from "@/lib/routine-schedule";
type Change =
  | { kind: "erase"; userId: string; memberIds: readonly string[] }
  | { kind: "link"; userId: string; memberId: string }
  | { kind: "invalidate"; userId?: string; memberIds: readonly string[] };
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
/** Pure exact-subject rewrite; display labels never establish identity. */
export function rewriteRoutineFutureSubject(
  raw: unknown,
  change: Change,
): { value: unknown; stackId: string | null } | null {
  const parsed = routineStepSeriesConfig.safeParse(raw);
  if (change.kind === "link") {
    if (!parsed.success) return null;
    const subject = parsed.data.content.subject;
    const sameProfile =
      subject.kind === "profile" && subject.member_id === change.memberId;
    const sameUnmappedAccount =
      subject.kind === "account" &&
      subject.user_id === change.userId &&
      subject.member_id === null;
    if (!sameProfile && !sameUnmappedAccount) return null;
    return {
      value: routineStepSeriesConfig.parse({
        ...parsed.data,
        revision: Math.min(2147483647, parsed.data.revision + 1),
        content: {
          ...parsed.data.content,
          subject: {
            kind: "account",
            user_id: change.userId,
            member_id: change.memberId,
          },
        },
      }),
      stackId: parsed.data.stack_id,
    };
  }
  if (change.kind === "invalidate") {
    if (!parsed.success) return null; // Unsupported metadata already refuses fresh edits.
    const subject = parsed.data.content.subject;
    const matches =
      (subject.kind === "account" &&
        !!change.userId &&
        subject.user_id === change.userId) ||
      (subject.kind !== "erased" &&
        subject.member_id !== null &&
        change.memberIds.includes(subject.member_id));
    return matches
      ? {
          value: routineStepSeriesConfig.parse({
            ...parsed.data,
            revision: Math.min(2147483647, parsed.data.revision + 1),
          }),
          stackId: parsed.data.stack_id,
        }
      : null;
  }
  // Redact the known identifying slot even if an unknown future protocol holds
  // the row. Never adopt/normalize that unknown definition into a supported one.
  const object = record(raw),
    content = record(object?.content),
    subject = record(content?.subject);
  if (
    !object ||
    !content ||
    !subject ||
    !(
      (typeof subject.user_id === "string" &&
        subject.user_id === change.userId) ||
      (typeof subject.member_id === "string" &&
        change.memberIds.includes(subject.member_id))
    )
  )
    return null;
  const revision = parsed.success
    ? parsed.data.revision
    : typeof object.revision === "number" &&
        Number.isInteger(object.revision) &&
        object.revision > 0
      ? object.revision
      : 1;
  const value = {
    ...(parsed.success ? parsed.data : object),
    revision: Math.min(2147483647, revision + 1),
    content: {
      ...(parsed.success ? parsed.data.content : content),
      subject: { kind: "erased" },
    },
  };
  return {
    value: parsed.success ? routineStepSeriesConfig.parse(value) : value,
    stackId: typeof object.stack_id === "string" ? object.stack_id : null,
  };
}
/** Source can coexist with pre-migration deployments; erasure never depends on a rollout flag. */
export async function hasRoutineSubjectStorage(
  tx: Pick<Prisma.TransactionClient, "$queryRaw">,
) {
  const rows = await tx.$queryRaw<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"Chore"') AND attname = 'routine_series_config' AND NOT attisdropped) AS present`;
  return rows.length === 1 && rows[0].present === true;
}
/** Caller owns account then household lock. No occurrence ownership/credit changes. */
export async function rewriteRoutineSubjectsInTx(
  tx: Prisma.TransactionClient,
  familyId: string,
  change: Change,
): Promise<string[]> {
  if (!(await hasRoutineSubjectStorage(tx))) return [];
  // Query by exact private subject identifiers, not historic occurrence assignees:
  // a root may already describe future work for a different person.
  const members =
    change.kind === "link" ? [change.memberId] : [...new Set(change.memberIds)];
  const userId = change.userId ?? null;
  const rows = await tx.$queryRaw<
    { id: string; routine_series_config: unknown }[]
  >`
    SELECT "id", "routine_series_config" FROM "Chore"
    WHERE "family_id" = ${familyId} AND "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
      AND ("routine_series_config"->'content'->'subject'->>'user_id' = ${userId}
        OR "routine_series_config"->'content'->'subject'->>'member_id' = ANY(${members}::text[]))
    ORDER BY "id" FOR UPDATE`;
  const stacks = new Set<string>(),
    changed: string[] = [];
  for (const row of rows) {
    const next = rewriteRoutineFutureSubject(row.routine_series_config, change);
    if (!next) continue;
    const count =
      await tx.$executeRaw`UPDATE "Chore" SET "routine_series_config" = ${JSON.stringify(next.value)}::jsonb WHERE "id" = ${row.id} AND "family_id" = ${familyId} AND "recurrence_id" = "id"`;
    if (count !== 1)
      throw new Error("Routine subject changed during identity transaction");
    changed.push(row.id);
    if (next.stackId) stacks.add(next.stackId);
  }
  if (stacks.size === 0) return changed;
  const stackStorage = await tx.$queryRaw<
    { present: boolean }[]
  >`SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('"RoutineStack"') AND attname = 'schedule_config' AND NOT attisdropped) AS present`;
  if (stackStorage.length !== 1 || stackStorage[0].present !== true)
    return changed;
  for (const stackId of [...stacks].sort()) {
    const rows = await tx.$queryRaw<
      { id: string; label: string; version: number; schedule_config: unknown }[]
    >`SELECT "id", "label", "version", "schedule_config" FROM "RoutineStack" WHERE "id" = ${stackId} AND "family_id" = ${familyId} FOR UPDATE`;
    if (rows.length !== 1) continue; // An unavailable stack never grants new authority.
    const row = rows[0],
      config = routineScheduleConfig.safeParse(row.schedule_config),
      version = Math.min(2147483647, row.version + 1);
    const fingerprint = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          label: row.label,
          version,
          config: config.success ? config.data : row.schedule_config,
        }),
      )
      .digest("hex");
    await tx.$executeRaw`UPDATE "RoutineStack" SET "version" = ${version}, "fingerprint" = ${fingerprint}, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = ${stackId} AND "family_id" = ${familyId}`;
  }
  return changed;
}

/** Future aliases and personal control roots can survive leaving without a profile mapping. */
export async function routineSubjectHouseholds(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<string[]> {
  if (!(await hasRoutineSubjectStorage(tx))) return [];
  const rows = await tx.$queryRaw<{ family_id: string }[]>`
    SELECT DISTINCT "family_id" FROM "Chore" WHERE "recurrence_id" = "id" AND "routine_series_config" IS NOT NULL
      AND ("routine_series_config"->'content'->'subject'->>'user_id' = ${userId} OR "assigned_to" = ${userId})
    ORDER BY "family_id"`;
  return rows.map((row) => row.family_id);
}
