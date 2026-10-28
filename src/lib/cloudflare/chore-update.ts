/** Explicit native edit plan: captured source reads, then material/series effects
 * in one D1 batch. No read facade is given mutation or transaction methods. */
import type { z } from "zod";
import type { updateChoreSchema } from "@/lib/validations";
import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { publicChoreData } from "@/lib/chore-public-data";
import { normalizeDateOnlyInput } from "@/lib/dates";
import { normalizedWeekdays, nextSelectedWeekday } from "@/lib/chore-weekdays";
import { sameRotation, planRotationTurns } from "@/lib/chore-rotation-shared";
import {
  eligibleChoreAssigneeFromReads,
  type ChoreAssigneeReadDb,
} from "@/lib/chore-member-subject";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import {
  resolveChorePhotoForWrite,
  type ChorePhotoReadDb,
} from "@/lib/chore-photos";
import {
  profileChoreLegacyWriteRefusal,
  isProfileChoreRecurrenceSupported,
} from "@/lib/chore-profile";
import { RoutineScheduleLegacyWriteError } from "@/lib/routine-schedule-legacy";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
} from "@/lib/routine-occurrence-policy";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1, D1ReadClient } from "./read-client";
import { isD1WriteConflict } from "./write-check";
import {
  prepareD1RecurringSeries,
  type EditedRecurringChore,
} from "./recurring-chores";

type Input = z.infer<typeof updateChoreSchema>;
type Chore = Awaited<ReturnType<D1ReadClient["chore"]["findUniqueOrThrow"]>>;
type Occurrence = Pick<
  Chore,
  | "id"
  | "due_date"
  | "status"
  | "assigned_to"
  | "assigned_member_id"
  | "rotation_index"
>;
type Patch = Record<string, SqlValue>;
const fail = (status: number, error: string, code?: string) => ({
  status,
  body: { error, ...(code ? { code } : {}) },
});
const parentFields = [
  "points",
  "difficulty",
  "assigned_to",
  "frequency",
  "weekly_days",
  "rotation",
] as const;
function routineRefusal() {
  const e = new RoutineScheduleLegacyWriteError();
  return fail(409, e.message, e.code);
}
function storedWeekdays(value: unknown): number[] {
  if (
    !Array.isArray(value) ||
    !value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  )
    throw new Error("Invalid stored weekdays");
  return value;
}
function storedRotation(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
    throw new Error("Invalid stored rotation");
  return value;
}
function snapshotRoot(row: Chore): EditedRecurringChore["root"] {
  if (row.routine_series_config !== null)
    throw new Error("Versioned routine is not a legacy series");
  return {
    ...row,
    weekly_days: storedWeekdays(row.weekly_days),
    rotation_member_ids: storedRotation(row.rotation_member_ids),
    routine_series_config: null,
  };
}
function updateStatement(
  session: Pick<D1Store, "prepare">,
  familyId: string,
  id: string,
  patch: Patch,
) {
  // Column names only come from the closed material/schedule plan below.
  const entries = Object.entries(patch),
    values: SqlValue[] = entries.map(([, v]) => v);
  return session
    .prepare(
      `UPDATE "Chore" SET ${entries.map(([key], i) => `"${key}"=?${i + 1}`).join(",")} WHERE id=?${values.length + 1} AND family_id=?${values.length + 2}`,
    )
    .bind(...values, id, familyId);
}
export async function updateD1Chore(
  actor: AssistantProofActor,
  input: Input,
  options: { database?: D1Store; now?: Date } = {},
) {
  const store = options.database ?? (await getD1Database()),
    session = store.withSession("first-primary"),
    now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid chore edit clock");
  const tomorrow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  const normalizedDate =
    input.due_date === undefined
      ? undefined
      : normalizeDateOnlyInput(input.due_date);
  if (normalizedDate === null) return fail(400, "Invalid date");
  for (let attempt = 0; attempt < 16; attempt++) {
    try {
      const captured = await captureD1Reads(
        async (db) => {
          const caller = await db.user.findUnique({
            where: { id: actor.userId },
            select: { family_id: true, role: true, token_version: true },
          });
          if (!caller || caller.token_version !== actor.generation)
            return { denied: fail(401, "Unauthorized") };
          if (caller.family_id !== actor.familyId || caller.role !== actor.role)
            return { denied: fail(403, "Forbidden") };
          const family = await db.family.findUnique({
            where: { id: actor.familyId },
            select: { features: true },
          });
          if (!family) return { denied: fail(403, "Forbidden") };
          const current = await db.chore.findUnique({
            where: { id: input.choreId },
          });
          if (!current) return { denied: fail(404, "Chore not found") };
          if (current.family_id !== actor.familyId)
            return { denied: fail(403, "Forbidden") };
          if (
            current.member_subject_erased &&
            input.assigned_to !== undefined &&
            input.assigned_to !== current.assigned_to
          )
            return {
              denied: fail(
                409,
                "An erased chore subject cannot be reassigned",
                "IDENTITY_CONFLICT",
              ),
            };
          if (
            current.assigned_to === null &&
            current.assigned_member_id !== null
          )
            return {
              denied: { status: 409, body: profileChoreLegacyWriteRefusal() },
            };
          if (actor.role !== "parent" && current.assigned_to !== actor.userId)
            return {
              denied: fail(403, "Only parents or the assignee can edit chores"),
            };
          if (actor.role !== "parent") {
            const attempted = parentFields.filter(
              (key) => input[key] !== undefined,
            );
            if (attempted.length)
              return {
                denied: fail(
                  403,
                  `Only parents can change: ${attempted.join(", ")}`,
                ),
              };
          }
          let root = current.recurrence_id
            ? await db.chore.findFirst({
                where: { id: current.recurrence_id, family_id: actor.familyId },
              })
            : null;
          const seriesCommand =
            input.apply_to_series === true ||
            input.frequency !== undefined ||
            input.rotation !== undefined;
          if (
            current.routine_series_config !== null ||
            (seriesCommand && root?.routine_series_config != null)
          )
            return { denied: routineRefusal() };
          const policy = routineOccurrencePolicy({
            ...current,
            own_config: current.routine_series_config,
            root_id: root?.id ?? null,
            root_recurrence_id: root?.recurrence_id ?? null,
            series_config: root?.routine_series_config ?? null,
          } as RoutineOccurrenceSnapshot);
          if (policy === "inactive" || policy === "unsupported")
            return { denied: routineRefusal() };
          if (input.assigned_to !== undefined) {
            const selected = await db.user.findFirst({
              where: { id: input.assigned_to, family_id: actor.familyId },
              select: { id: true },
            });
            if (!selected)
              return {
                denied: fail(400, "Assignee must be a member of your family"),
              };
          }
          if (input.rotation) {
            const members = await db.user.findMany({
              where: { id: { in: input.rotation }, family_id: actor.familyId },
              select: { id: true },
            });
            if (
              input.rotation.some((id) => !members.some((row) => row.id === id))
            )
              return {
                denied: fail(
                  400,
                  "Everyone taking turns must be in your family",
                ),
              };
          }
          const photo = await resolveChorePhotoForWrite(
            actor.familyId,
            input.photo_url,
            current.photo_url,
            db as unknown as ChorePhotoReadDb,
          );
          if (!photo.ok) return { denied: fail(400, photo.error) };
          const initial: Patch = {};
          for (const key of [
            "title",
            "description",
            "points",
            "assigned_to",
            "difficulty",
            "icon",
            "routine",
            "routine_order",
          ] as const) {
            if (input[key] !== undefined) initial[key] = input[key] as SqlValue;
          }
          if (normalizedDate) initial.due_date = normalizedDate.getTime();
          if (photo.value !== undefined) initial.photo_url = photo.value;
          if (input.assigned_to !== undefined && current.assigned_member_id) {
            const identity = await eligibleChoreAssigneeFromReads(
              db as unknown as ChoreAssigneeReadDb,
              actor.familyId,
              input.assigned_to,
              { requireCanonical: true },
            );
            if (!identity?.assigned_member_id)
              throw new HouseholdMemberIdentityConflict();
            initial.assigned_member_id = identity.assigned_member_id;
          }
          const edited = {
            ...current,
            ...initial,
            due_date: normalizedDate ?? current.due_date,
          } as Chore;
          if (root?.id === current.id) root = edited;
          const patches = new Map<string, Patch>();
          const rows = new Map<string, Occurrence>();
          const deleted = new Set<string>();
          const patch = (id: string, values: Patch) => {
            patches.set(id, { ...patches.get(id), ...values });
            const row = rows.get(id);
            if (row)
              Object.assign(row, values, {
                ...(values.due_date !== undefined
                  ? { due_date: new Date(values.due_date as number) }
                  : {}),
              });
            if (root?.id === id)
              Object.assign(root, values, {
                ...(values.due_date !== undefined
                  ? { due_date: new Date(values.due_date as number) }
                  : {}),
              });
          };
          // Complete paged membership is witnessed, including the empty final page.
          // Scalar selections avoid composite reads and keep the atomic plan bounded
          // by the existing witness limit rather than silently dropping occurrences.
          if (root && seriesCommand) {
            let after: string | undefined;
            for (;;) {
              const batch = await db.chore.findMany({
                where: {
                  family_id: actor.familyId,
                  recurrence_id: root.id,
                  ...(after ? { id: { gt: after } } : {}),
                },
                select: {
                  id: true,
                  due_date: true,
                  status: true,
                  assigned_to: true,
                  assigned_member_id: true,
                  rotation_index: true,
                },
                orderBy: { id: "asc" },
                take: 100,
              });
              for (const row of batch) rows.set(row.id, row);
              if (batch.length < 100) break;
              after = batch[batch.length - 1].id;
            }
          }
          rows.set(current.id, { ...edited });
          let expand = false;
          if (input.frequency !== undefined) {
            const frequency = input.frequency;
            if (
              frequency !== "once" &&
              ((edited.assigned_to === null &&
                edited.assigned_member_id !== null) ||
                (root?.assigned_to === null &&
                  root.assigned_member_id !== null)) &&
              !isProfileChoreRecurrenceSupported()
            )
              return { denied: fail(409, "MEMBER_PROTOCOL_UNAVAILABLE") };
            const prior = normalizedWeekdays(
                storedWeekdays(root?.weekly_days ?? current.weekly_days),
              ),
              next =
                frequency === "weekly"
                  ? normalizedWeekdays(input.weekly_days ?? prior)
                  : [];
            const changed = JSON.stringify(prior) !== JSON.stringify(next);
            if (root) {
              if (
                (root.id === current.id || input.apply_to_series === true) &&
                (root.frequency !== frequency || changed)
              ) {
                patch(root.id, {
                  frequency,
                  weekly_days: JSON.stringify(next),
                  is_template: Number(frequency !== "once"),
                });
                // JSON fields remain typed in the explicit post-effect snapshot.
                root.weekly_days = next;
                root.is_template = frequency !== "once";
                for (const row of rows.values())
                  if (
                    row.id !== root.id &&
                    row.id !== current.id &&
                    row.status === "pending" &&
                    row.due_date >= tomorrow
                  )
                    deleted.add(row.id);
                if (frequency === "weekly" && next.length) {
                  const future = [...rows.values()]
                    .filter(
                      (row) => !deleted.has(row.id) && row.due_date >= tomorrow,
                    )
                    .sort(
                      (a, b) =>
                        a.due_date.getTime() - b.due_date.getTime() ||
                        a.id.localeCompare(b.id),
                    );
                  const occupied = new Set(
                    future.map((row) => row.due_date.getTime()),
                  );
                  for (const row of future) {
                    if (
                      row.status !== "pending" ||
                      ![root.id, current.id].includes(row.id) ||
                      next.includes(row.due_date.getUTCDay())
                    )
                      continue;
                    occupied.delete(row.due_date.getTime());
                    let day = nextSelectedWeekday(row.due_date, next, true)!;
                    while (occupied.has(day.getTime()))
                      day = nextSelectedWeekday(day, next)!;
                    patch(row.id, { due_date: day.getTime() });
                    occupied.add(day.getTime());
                  }
                }
                expand = frequency !== "once";
              }
            } else if (frequency !== current.frequency || changed) {
              if (frequency === "once")
                patch(current.id, {
                  frequency,
                  weekly_days: JSON.stringify(next),
                });
              else {
                root = {
                  ...edited,
                  frequency,
                  weekly_days: next,
                  recurrence_id: current.id,
                  is_template: true,
                };
                patch(current.id, {
                  frequency,
                  weekly_days: JSON.stringify(next),
                  recurrence_id: current.id,
                  is_template: 1,
                });
                root.weekly_days = next;
                root.is_template = true;
                expand = true;
              }
            }
          }
          // Keep pre-frequency material writes separate so canonical trigger epochs
          // advance at the same points as PostgreSQL; don't squash real transitions.
          const frequencyPatches = [...patches].map(([id, p]) => ({
            id,
            patch: { ...p },
          }));
          patches.clear();
          const expandState =
            expand && root
              ? {
                  root: snapshotRoot(root),
                  occurrences: [...rows.values()].filter(
                    (row) => !deleted.has(row.id),
                  ),
                }
              : null;
          return {
            current,
            edited,
            root,
            initial,
            rows,
            deleted,
            frequencyPatches,
            expandState,
            patches,
            family,
          };
        },
        store as unknown as NativeD1,
      );
      if (captured.value.denied) {
        await session.batch(captured.checks(session));
        return captured.value.denied;
      }
      const plan = captured.value,
        checks = captured.checks(session),
        effects = [];
      if (Object.keys(plan.initial).length)
        effects.push(
          updateStatement(session, actor.familyId, input.choreId, plan.initial),
        );
      for (const { id, patch } of plan.frequencyPatches)
        effects.push(updateStatement(session, actor.familyId, id, patch));
      for (const id of plan.deleted)
        effects.push(
          session
            .prepare('DELETE FROM "Chore" WHERE id=?1 AND family_id=?2')
            .bind(id, actor.familyId),
        );
      let series: Awaited<ReturnType<typeof prepareD1RecurringSeries>> | null =
        null;
      if (plan.expandState) {
        series = await prepareD1RecurringSeries(
          plan.expandState.root.id,
          actor.familyId,
          now,
          store,
          undefined,
          plan.expandState,
        );
        checks.push(...series.checks(session));
        effects.push(...series.writes(session).statements);
        for (const copy of series.previewCopies)
          plan.rows.set(copy.id, {
            ...copy,
            assigned_member_id: copy.assigned_member_id ?? null,
            status: "pending",
          });
      }
      if (input.rotation !== undefined) {
        const root = plan.root;
        if (!root?.is_template) {
          if (input.rotation)
            return fail(400, "Taking turns needs a chore that repeats");
        } else {
          const rotation = input.rotation ?? [],
            old = storedRotation(root.rotation_member_ids);
          if (!sameRotation(old, rotation)) {
            const rotationReads = await captureD1Reads(
              async (db) => {
                // Even a legacy/clear plan has a real source witness. The main
                // capture owns the full root; this read also binds rotation
                // planning to the same extant household root.
                await db.chore.findFirst({
                  where: { id: root.id, family_id: actor.familyId },
                  select: { id: true, rotation_member_ids: true },
                });

                const identities = new Map<
                  string,
                  { assigned_to: string; assigned_member_id: string }
                >();
                const future = [...plan.rows.values()]
                  .filter(
                    (row) =>
                      !plan.deleted.has(row.id) &&
                      row.status === "pending" &&
                      row.due_date >= tomorrow,
                  )
                  .sort(
                    (a, b) =>
                      a.due_date.getTime() - b.due_date.getTime() ||
                      a.id.localeCompare(b.id),
                  )
                  .filter(
                    (row) =>
                      !old.length ||
                      (row.rotation_index !== null &&
                        old[row.rotation_index] === row.assigned_to),
                  );
                const turns = planRotationTurns(rotation, null, future.length);
                if (rotation.length)
                  for (let index = 0; index < future.length; index++) {
                    const id = turns[index]?.assignee;
                    if (
                      future[index].assigned_member_id &&
                      id &&
                      !identities.has(id)
                    ) {
                      const identity = await eligibleChoreAssigneeFromReads(
                        db as unknown as ChoreAssigneeReadDb,
                        actor.familyId,
                        id,
                        { requireCanonical: true },
                      );
                      if (!identity?.assigned_member_id)
                        throw new HouseholdMemberIdentityConflict();
                      identities.set(id, {
                        assigned_to: id,
                        assigned_member_id: identity.assigned_member_id,
                      });
                    }
                  }
                return { future, turns, identities };
              },
              store as unknown as NativeD1,
            );
            checks.push(...rotationReads.checks(session));
            effects.push(
              updateStatement(session, actor.familyId, root.id, {
                rotation_member_ids: JSON.stringify(rotation),
              }),
            );
            effects.push(
              session
                .prepare(
                  'UPDATE "Chore" SET rotation_index=NULL WHERE family_id=?1 AND recurrence_id=?2',
                )
                .bind(actor.familyId, root.id),
            );
            if (rotation.length)
              for (
                let index = 0;
                index < rotationReads.value.future.length;
                index++
              ) {
                const row = rotationReads.value.future[index],
                  turn = rotationReads.value.turns[index],
                  identity =
                    row.assigned_member_id && turn.assignee
                      ? rotationReads.value.identities.get(turn.assignee)
                      : undefined;
                effects.push(
                  updateStatement(session, actor.familyId, row.id, {
                    rotation_index: turn.index,
                    ...(identity ??
                      (turn.assignee ? { assigned_to: turn.assignee } : {})),
                  }),
                );
              }
          }
        }
      }
      // Even a semantic no-op checks current authority and target membership.
      await session.batch([...checks, ...effects]);
      return await readD1EditedChore(actor, input.choreId, store);
    } catch (cause) {
      if (isD1WriteConflict(cause)) continue;
      if (cause instanceof HouseholdMemberIdentityConflict)
        return fail(409, cause.message, "IDENTITY_CONFLICT");
      throw cause;
    }
  }
  return fail(409, "Chore changed. Reload it before saving.", "CHORE_CHANGED");
}
export async function readD1EditedChore(
  actor: AssistantProofActor,
  id: string,
  database?: D1Store,
) {
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  const captured = await captureD1Reads(
    async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (!user || user.token_version !== actor.generation)
        return fail(401, "Unauthorized");
      if (user.family_id !== actor.familyId || user.role !== actor.role)
        return fail(403, "Forbidden");
      const family = await db.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      const row = await db.chore.findFirst({
        where: { id, family_id: actor.familyId },
      });
      if (!row) return fail(404, "Chore not found");
      const [assignee, creator] = await Promise.all([
        row.assigned_to
          ? db.user.findFirst({
              where: { id: row.assigned_to, family_id: actor.familyId },
              select: { id: true, name: true, avatar_url: true },
            })
          : null,
        db.user.findFirst({
          where: { id: row.created_by, family_id: actor.familyId },
          select: { id: true, name: true },
        }),
      ]);
      const { points, ...rest } = row;
      return {
        status: 200,
        body: {
          chore: publicChoreData({
            ...rest,
            ...(family &&
            isFeatureEnabled(normalizeFeatures(family.features), "gamification")
              ? { points }
              : {}),
            assignee,
            creator,
          }),
        },
      };
    },
    store as unknown as NativeD1,
  );
  await session.batch(captured.checks(session));
  return captured.value;
}
