/** Fresh person-only authorization and content-minimal canonical projection. */
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  ScheduleReviewError,
  scheduleReviewScope,
  scheduleReviewSnapshot,
  planScheduleReview,
  requireScheduleIntentAge,
  scheduleMoveCommand,
  type ScheduleReviewScope,
  type ScheduleMoveCommand,
  type ScheduleReviewQuery,
} from "./conflict-review";
import {
  lockScheduleTarget,
  readScheduleComparisonInTx,
  scheduleEventToken,
  scheduleSnapshotToken,
} from "./schedule-source";
import {
  readScheduleStatuses,
  scheduleStatusToken,
  assessScheduleSourceCoverage,
} from "./schedule-status";
export { SCHEDULE_SOURCE_FRESHNESS_MS } from "./schedule-status";
export type ScheduleActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
};
export async function openScheduleActorInTx(
  tx: Prisma.TransactionClient,
  actor: ScheduleActor,
) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const users = await tx.$queryRaw<
    Array<{
      id: string;
      family_id: string | null;
      role: string;
      token_version: number;
    }>
  >`SELECT "id", "family_id", "role", "token_version" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
  const user = users[0];
  if (
    !user ||
    user.id !== actor.userId ||
    user.token_version !== actor.tokenVersion
  )
    throw new ScheduleReviewError("UNAUTHORIZED");
  if (
    user.family_id !== actor.familyId ||
    !["parent", "teen", "child"].includes(user.role)
  )
    throw new ScheduleReviewError("FORBIDDEN");
  const families = await tx.$queryRaw<
    Array<{ features: unknown }>
  >`SELECT "features" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
  if (!families[0]) throw new ScheduleReviewError("FORBIDDEN");
  return {
    role: user.role as "parent" | "teen" | "child",
    features: normalizeFeatures(families[0].features),
  };
}
export function authorizeScheduleReceipt(
  db: PrismaClient,
  actor: ScheduleActor,
) {
  return db.$transaction(async (tx) => {
    const current = await openScheduleActorInTx(tx, actor);
    return {
      role: current.role,
      calendarEnabled: isFeatureEnabled(current.features, "calendar"),
    };
  });
}
/** Actor/Family already renewed/locked; selected target is locked before any
 * comparison. No blocker/source/identity row lock is acquired afterward. */
export async function prepareScheduleInTx(
  tx: Prisma.TransactionClient,
  actor: ScheduleActor,
  current: Awaited<ReturnType<typeof openScheduleActorInTx>>,
  rawScope: ScheduleReviewScope,
  now = new Date(),
) {
  if (!isFeatureEnabled(current.features, "calendar"))
    throw new ScheduleReviewError("FORBIDDEN");
  const parsed = scheduleReviewScope.parse(rawScope);
  const scope = {
    ...parsed,
    range: {
      start: new Date(parsed.range.start).toISOString(),
      end: new Date(parsed.range.end).toISOString(),
    },
  };
  await lockScheduleTarget(tx, actor.familyId, scope.targetId);
  const before = await readScheduleStatuses(tx, actor.familyId);
  const rows = await readScheduleComparisonInTx(
    tx,
    actor.familyId,
    scope.targetId,
    scope.range,
  );
  const statuses = await readScheduleStatuses(tx, actor.familyId);
  const statusToken = scheduleStatusToken(statuses);
  if (scheduleStatusToken(before) !== statusToken)
    throw new ScheduleReviewError("STALE");
  if (!rows.some((row) => row.id === scope.targetId))
    throw new ScheduleReviewError("MISSING");
  const { capped, sourcesUnavailable, missingSource } =
    assessScheduleSourceCoverage(rows, statuses, now);
  const coverage = {
    complete: !capped && !sourcesUnavailable,
    recurrence: rows.some((row) => row.recurrence !== null)
      ? ("stored-only" as const)
      : ("complete" as const),
    sourcesUnavailable,
    capped,
  };
  const events = rows.slice(0, 500).map((row) => ({
    id: row.id,
    title: Array.from(row.title.normalize("NFC")).slice(0, 240).join(""),
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    sourceToken: scheduleEventToken(actor.familyId, {
      id: row.id,
      generation: row.generation,
      epoch: row.epoch,
    }),
    origin: row.sourceSubscriptionId
      ? ("subscribed" as const)
      : row.sourceConnectionId
        ? ("connected" as const)
        : ("local" as const),
    repeating: row.recurrence !== null,
    canMove:
      current.role === "parent" &&
      !row.sourceSubscriptionId &&
      row.recurrence === null &&
      !missingSource,
  }));
  const owner = { userId: actor.userId, familyId: actor.familyId };
  const parsedSnapshot = scheduleReviewSnapshot.safeParse({
    protocol: "herewoven.schedule-review.v1",
    owner,
    role: current.role,
    timeZone: scope.timeZone,
    range: scope.range,
    coverage,
    events,
    snapshotToken: scheduleSnapshotToken({
      owner,
      role: current.role,
      tokenVersion: actor.tokenVersion,
      sourceStatusToken: statusToken,
      timeZone: scope.timeZone,
      range: scope.range,
      coverage,
      events,
    }),
  });
  if (!parsedSnapshot.success) throw new ScheduleReviewError("UNAVAILABLE");
  return {
    snapshot: parsedSnapshot.data,
    compared: rows.map(({ id, generation, epoch }) => ({
      id,
      generation,
      epoch,
    })),
    sourceStatuses: statuses,
  };
}
export function scopeForScheduleCommand(
  command: ScheduleReviewQuery,
): ScheduleReviewScope {
  return {
    targetId: command.target.id,
    range: command.range,
    timeZone: command.timeZone,
  };
}
export function requireScheduleOwner(
  command: ScheduleReviewQuery,
  actor: ScheduleActor,
) {
  if (
    command.owner.userId !== actor.userId ||
    command.owner.familyId !== actor.familyId
  )
    throw new ScheduleReviewError("FORBIDDEN");
}
export function requireScheduleMove(
  snapshot: ReturnType<typeof scheduleReviewSnapshot.parse>,
  command: ScheduleMoveCommand,
  now: Date,
) {
  requireScheduleIntentAge(command, now);
  // Effect/age fields belong to the strict command, not the strict read query.
  const intent = scheduleMoveCommand.parse(command);
  const plan = planScheduleReview(
    snapshot,
    {
      protocol: intent.protocol,
      owner: intent.owner,
      range: intent.range,
      timeZone: intent.timeZone,
      snapshotToken: intent.snapshotToken,
      target: intent.target,
      buffers: intent.buffers,
      otherBuffers: intent.otherBuffers,
      windows: intent.windows,
      gridMinutes: intent.gridMinutes,
    },
    now,
  );
  if (
    !plan.canApply ||
    !plan.alternatives.some(
      (row) => row.start === command.start && row.end === command.end,
    )
  )
    throw new ScheduleReviewError("STALE");
  return plan;
}
export function readScheduleSnapshot(
  db: PrismaClient,
  actor: ScheduleActor,
  scope: ScheduleReviewScope,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    const current = await openScheduleActorInTx(tx, actor);
    return {
      snapshot: (await prepareScheduleInTx(tx, actor, current, scope, now))
        .snapshot,
      evaluatedAt: now.toISOString(),
    };
  });
}
export function previewScheduleQuery(
  db: PrismaClient,
  actor: ScheduleActor,
  query: ScheduleReviewQuery,
  now = new Date(),
) {
  requireScheduleOwner(query, actor);
  return db.$transaction(async (tx) => {
    const current = await openScheduleActorInTx(tx, actor),
      prepared = await prepareScheduleInTx(
        tx,
        actor,
        current,
        scopeForScheduleCommand(query),
        now,
      );
    planScheduleReview(prepared.snapshot, query, now);
    return { snapshot: prepared.snapshot, evaluatedAt: now.toISOString() };
  });
}
