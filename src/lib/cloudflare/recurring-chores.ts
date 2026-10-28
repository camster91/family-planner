import { randomUUID } from "node:crypto";
import { getD1Database, type D1Store, type SqlValue } from "./database";
import { captureD1Reads } from "./read-witness";
import {
  withD1ReadClient,
  type D1ReadClient,
  type NativeD1,
} from "./read-client";
import { isD1WriteConflict, d1WriteCheck } from "./write-check";
import {
  choreExpansionDays,
  choreExpansionWindowSize,
} from "@/lib/chore-expansion-window";
import { startOfDay } from "@/lib/chore-recurrence-dates";
import { planRotationTurns } from "@/lib/chore-rotation-shared";
import {
  eligibleChoreAssigneeFromReads,
  type ChoreAssigneeReadDb,
} from "@/lib/chore-member-subject";
import {
  PROFILE_CHORE_ELIGIBILITY_SELECT,
  profileChoreAssigneeFromSnapshot,
} from "@/lib/chore-profile-assignee";
import { isRoutineScheduleExpansionEnabled } from "@/lib/routine-schedule-gates";
import {
  routineStepSeriesConfig,
  routineScheduleConfig,
} from "@/lib/routine-schedule";
import { routineExpansionDays } from "@/lib/routine-schedule-expansion";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/profile-chore-gates";
import {
  isFairChoreTopUpEnabled,
  FAIR_CHORE_TOP_UP_MAX,
  FAIR_CHORE_TOP_UP_BUDGET_MS,
} from "@/lib/chore-top-up-gates";

type Subject = { assigned_to: string | null; assigned_member_id?: string };
type Copy = {
  family_id: string;
  created_by: string;
  title: string;
  description: string | null;
  points: number;
  difficulty: string;
  icon: string | null;
  routine: string | null;
  routine_order: number | null;
  routine_stack_id?: string | null;
  routine_anchor?: string | null;
  routine_duration_minutes?: number | null;
  due_date: Date;
  recurrence_id: string;
  rotation_index: number | null;
} & Subject;
type Plan = {
  copies: Copy[];
  settleOnce?: boolean;
  gate?: "routine";
  profileRepeating?: boolean;
};
const empty = (): Plan => ({ copies: [] });
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
    throw new Error("Invalid stored rotation");
  return value;
}
function numberArray(value: unknown): number[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === "number"))
    throw new Error("Invalid stored weekdays");
  return value;
}
async function available(db: D1ReadClient, familyId: string) {
  const family = await db.family.findUnique({
    where: { id: familyId },
    select: { features: true },
  });
  return (
    !!family && isFeatureEnabled(normalizeFeatures(family.features), "chores")
  );
}
async function account(
  db: D1ReadClient,
  familyId: string,
  userId: string,
  requireCanonical: boolean,
) {
  // This source-owned eligibility projection exposes only selected scalar reads;
  // no scalar-array filter, mutation, raw SQL or transaction method is granted.
  return eligibleChoreAssigneeFromReads(
    db as unknown as ChoreAssigneeReadDb,
    familyId,
    userId,
    { requireCanonical },
  );
}
async function profile(
  db: D1ReadClient,
  familyId: string,
  memberId: string,
  repeating = true,
) {
  const member = await db.householdMember.findFirst({
    where: { id: memberId, family_id: familyId },
    select: PROFILE_CHORE_ELIGIBILITY_SELECT,
  });
  return profileChoreAssigneeFromSnapshot(
    member,
    familyId,
    memberId,
    repeating,
  );
}
async function planSeries(
  db: D1ReadClient,
  templateId: string,
  familyId: string,
  now: Date,
): Promise<Plan> {
  const root = await db.chore.findUnique({ where: { id: templateId } });
  if (!root || root.family_id !== familyId || !(await available(db, familyId)))
    return empty();
  const base = {
    family_id: familyId,
    created_by: root.created_by,
    recurrence_id: root.id,
  };
  if (root.routine_series_config !== null) {
    if (!isRoutineScheduleExpansionEnabled() || root.recurrence_id !== root.id)
      return empty();
    const parsed = routineStepSeriesConfig.safeParse(
      root.routine_series_config,
    );
    if (!parsed.success || parsed.data.state !== "active") return empty();
    const definition = parsed.data;
    let label: string | null = null,
      order: number | null = null;
    if (definition.stack_id) {
      const row = await db.routineStack.findFirst({
        where: { id: definition.stack_id, family_id: familyId },
        select: { label: true, schedule_config: true },
      });
      const stack = routineScheduleConfig.safeParse(row?.schedule_config);
      if (
        !row ||
        !stack.success ||
        stack.data.state !== definition.state ||
        stack.data.effective_on !== definition.effective_on ||
        stack.data.anchor !== definition.anchor ||
        JSON.stringify(stack.data.schedule) !==
          JSON.stringify(definition.schedule)
      )
        return empty();
      const index = stack.data.steps.findIndex(
        (step) => step.template_id === root.id,
      );
      if (index < 0) return empty();
      label = row.label;
      order = index + 1;
    }
    const subject = definition.content.subject;
    if (subject.kind === "erased") return empty();
    const assignee =
      subject.kind === "profile"
        ? await profile(
            db,
            familyId,
            subject.member_id,
            definition.schedule.frequency !== "once",
          )
        : await account(
            db,
            familyId,
            subject.user_id,
            subject.member_id !== null,
          );
    if (
      !assignee ||
      (subject.kind === "account" &&
        subject.member_id !== null &&
        assignee.assigned_member_id !== subject.member_id)
    )
      return empty();
    const days = routineExpansionDays(
      definition,
      startOfDay(now).toISOString().slice(0, 10),
    );
    const existing = days.length
      ? await db.chore.findMany({
          where: {
            family_id: familyId,
            recurrence_id: root.id,
            due_date: { in: days.map((day) => new Date(day + "T00:00:00Z")) },
          },
          select: { due_date: true },
        })
      : [];
    const occupied = new Set(
        existing.map((row) => row.due_date.toISOString().slice(0, 10)),
      ),
      content = definition.content;
    return {
      gate: "routine",
      profileRepeating:
        subject.kind === "profile"
          ? definition.schedule.frequency !== "once"
          : undefined,
      settleOnce:
        definition.schedule.frequency === "once" && definition.once_pending,
      copies: days
        .filter((day) => !occupied.has(day))
        .map((day) => ({
          ...base,
          ...assignee,
          title: content.title,
          description: content.description,
          points: content.points,
          difficulty: content.difficulty,
          icon: content.icon,
          routine: label,
          routine_order: order,
          routine_stack_id: definition.stack_id,
          routine_anchor: definition.anchor,
          routine_duration_minutes: content.duration_minutes,
          rotation_index: null,
          due_date: new Date(day + "T00:00:00Z"),
        })),
    };
  }
  const weeklyDays = numberArray(root.weekly_days),
    rotation = stringArray(root.rotation_member_ids);
  const size = choreExpansionWindowSize(root.frequency, weeklyDays);
  if (!size) return empty();
  let profileSubject: Subject | null = null;
  if (root.assigned_to === null) {
    if (
      !root.assigned_member_id ||
      root.member_subject_erased ||
      root.recurrence_id !== root.id ||
      !root.is_template ||
      rotation.length
    )
      return empty();
    profileSubject = await profile(db, familyId, root.assigned_member_id);
    if (!profileSubject) return empty();
  }
  const upcoming = await db.chore.findMany({
    where: {
      family_id: familyId,
      recurrence_id: root.id,
      due_date: { gte: startOfDay(now) },
    },
    select: { due_date: true },
    orderBy: [{ due_date: "asc" }, { id: "asc" }],
    take: size,
  });
  if (upcoming.length >= size) return empty();
  const latest = await db.chore.findFirst({
    where: { family_id: familyId, recurrence_id: root.id },
    select: { due_date: true, rotation_index: true },
    orderBy: [{ due_date: "desc" }, { id: "desc" }],
  });
  const days = choreExpansionDays(
    { ...root, weekly_days: weeklyDays },
    upcoming,
    latest,
    now,
  );
  if (!days.length) return empty();
  const assignees = new Map<string, Subject>();
  if (root.assigned_to !== null) {
    for (const id of new Set(rotation.length ? rotation : [root.assigned_to])) {
      const subject = await account(
        db,
        familyId,
        id,
        !!root.assigned_member_id,
      );
      if (subject) assignees.set(id, subject);
    }
    if (!assignees.size) return empty();
  }
  const turns = rotation.length
    ? planRotationTurns(
        rotation,
        latest?.rotation_index ?? null,
        days.length,
        (id) => assignees.has(id),
      )
    : [];
  return {
    profileRepeating: profileSubject ? true : undefined,
    copies: days.map((due_date, index) => ({
      ...base,
      ...(profileSubject ??
        assignees.get(turns[index]?.assignee ?? root.assigned_to!)!),
      title: root.title,
      description: root.description,
      points: root.points,
      difficulty: root.difficulty,
      icon: root.icon,
      routine: root.routine,
      routine_order: root.routine_order,
      routine_stack_id: null,
      rotation_index: turns[index]?.index ?? null,
      due_date,
    })),
  };
}
function gateCurrent(plan: Plan) {
  if (plan.gate === "routine" && !isRoutineScheduleExpansionEnabled())
    return false;
  if (
    plan.profileRepeating !== undefined &&
    !(plan.profileRepeating
      ? isProfileChoreRecurrenceSupported()
      : isProfileChoreEnabled())
  )
    return false;
  return true;
}
/** Source reads and all generated copies/checkpoints commit in one native batch.
 * Concurrent visits replan after a failed witness; unique series/date is the
 * final collision guard. No identity creation, ignored transaction or scheduler.
 */
export async function expandD1RecurringSeries(
  templateId: string,
  familyId: string,
  now = new Date(),
  database?: D1Store,
): Promise<number> {
  if (!Number.isFinite(now.getTime()))
    throw new Error("Invalid recurrence clock");
  const store = database ?? (await getD1Database()),
    session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 8; attempt++) {
    const captured = await captureD1Reads(
        (db) => planSeries(db, templateId, familyId, now),
        store as unknown as NativeD1,
      ),
      plan = captured.value;
    if ((!plan.copies.length && !plan.settleOnce) || !gateCurrent(plan))
      return 0;
    const statements = captured.checks(session),
      insertIndexes: number[] = [];
    const created = Date.now();
    for (const copy of plan.copies) {
      insertIndexes.push(statements.length);
      const values: SqlValue[] = [
        randomUUID(),
        copy.family_id,
        copy.created_by,
        copy.title,
        copy.description,
        copy.points,
        copy.difficulty,
        copy.icon,
        copy.routine,
        copy.routine_order,
        copy.routine_stack_id ?? null,
        copy.routine_anchor ?? null,
        copy.routine_duration_minutes ?? null,
        copy.due_date.getTime(),
        copy.recurrence_id,
        copy.assigned_to,
        copy.assigned_member_id ?? null,
        copy.rotation_index,
        created,
      ];
      statements.push(
        session
          .prepare(
            `INSERT INTO "Chore"(id,family_id,created_by,title,description,points,difficulty,icon,routine,routine_order,routine_stack_id,routine_anchor,routine_duration_minutes,due_date,recurrence_id,assigned_to,assigned_member_id,rotation_index,created_at,frequency,status,is_template,member_subject_erased)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,'once','pending',0,0)
        ON CONFLICT(recurrence_id,due_date) DO NOTHING`,
          )
          .bind(...values),
      );
    }
    if (plan.settleOnce)
      statements.push(
        session
          .prepare(
            `UPDATE "Chore" SET routine_series_config=json_set(routine_series_config,'$.once_pending',json('false')) WHERE id=?1 AND family_id=?2 AND recurrence_id=id`,
          )
          .bind(templateId, familyId),
      );
    try {
      const results = await session.batch(statements);
      return insertIndexes.reduce(
        (sum, index) => sum + results[index].meta.changes,
        0,
      );
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  throw new Error(
    "Recurring chore changed too often; retry the foreground visit",
  );
}
async function repeatingRoots(
  store: D1Store,
  familyId: string,
  after: string | null,
  take: number,
) {
  return withD1ReadClient(
    (db) =>
      db.chore.findMany({
        where: {
          family_id: familyId,
          is_template: true,
          frequency: { not: "once" },
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take,
      }),
    store as unknown as NativeD1,
  );
}
export async function expandAllD1RecurringChores(
  familyId: string,
  now = new Date(),
  database?: D1Store,
) {
  const store = database ?? (await getD1Database());
  let inserted = 0,
    after: string | null = null;
  for (;;) {
    const roots = await repeatingRoots(store, familyId, after, 100);
    for (const root of roots)
      inserted += await expandD1RecurringSeries(root.id, familyId, now, store);
    if (roots.length < 100) return inserted;
    after = roots.at(-1)!.id;
  }
}
async function onceRoots(store: D1Store, familyId: string) {
  if (!isRoutineScheduleExpansionEnabled()) return [];
  const profiles = isProfileChoreEnabled() ? 1 : 0;
  const result = await store
    .withSession("first-primary")
    .prepare(
      `SELECT c.id FROM "Chore" c WHERE c.family_id=?1 AND c.recurrence_id=c.id
    AND json_valid(c.routine_series_config) AND json_extract(c.routine_series_config,'$.protocol')='herewoven.routine-step-series.v1'
    AND json_extract(c.routine_series_config,'$.state')='active' AND json_extract(c.routine_series_config,'$.schedule.frequency')='once'
    AND json_extract(c.routine_series_config,'$.once_pending')=1 AND (
      (json_extract(c.routine_series_config,'$.content.subject.kind')='account' AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=json_extract(c.routine_series_config,'$.content.subject.user_id') AND u.family_id=c.family_id)) OR
      (?2=1 AND json_extract(c.routine_series_config,'$.content.subject.kind')='profile' AND EXISTS(SELECT 1 FROM "HouseholdMember" m WHERE m.id=json_extract(c.routine_series_config,'$.content.subject.member_id') AND m.family_id=c.family_id AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberLegacyMapping" lm WHERE lm.member_id=m.id) AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberAccountLink" al WHERE al.member_id=m.id))))
    ORDER BY MAX(json_extract(c.routine_series_config,'$.schedule.starts_on'),json_extract(c.routine_series_config,'$.effective_on')),c.id LIMIT 100`,
    )
    .bind(familyId, profiles)
    .all<{ id: string }>();
  return result.results;
}
async function claimFairRoot(store: D1Store, familyId: string, seen: string[]) {
  const session = store.withSession("first-primary");
  for (let attempt = 0; attempt < 8; attempt++) {
    if (!isFairChoreTopUpEnabled()) return null;
    const family = await session
      .prepare('SELECT features FROM "Family" WHERE id=?1')
      .bind(familyId)
      .first<{ features: string | null }>();
    if (
      !family ||
      !isFeatureEnabled(
        normalizeFeatures(
          family.features === null ? null : JSON.parse(family.features),
        ),
        "chores",
      )
    )
      return null;
    try {
      const result = await session.batch<{ after_id: string }>([
        d1WriteCheck(
          session,
          'EXISTS(SELECT 1 FROM "Family" WHERE id=?1 AND features IS ?2)',
          [familyId, family.features],
        ),
        session
          .prepare(
            'INSERT INTO "ChoreTopUpCursor"(family_id,after_id) VALUES (?1,NULL) ON CONFLICT(family_id) DO NOTHING',
          )
          .bind(familyId),
        session
          .prepare(
            `UPDATE "ChoreTopUpCursor" SET after_id=(SELECT c.id FROM "Chore" c CROSS JOIN "ChoreTopUpCursor" p WHERE p.family_id=?1 AND c.family_id=?1 AND c.is_template=1 AND c.frequency<>'once'
          AND NOT EXISTS(SELECT 1 FROM json_each(?2) WHERE value=c.id)
          ORDER BY CASE WHEN p.after_id IS NULL OR c.id>p.after_id THEN 0 ELSE 1 END,c.id LIMIT 1)
          WHERE family_id=?1 AND EXISTS(SELECT 1 FROM "Chore" c WHERE c.family_id=?1 AND c.is_template=1 AND c.frequency<>'once' AND NOT EXISTS(SELECT 1 FROM json_each(?2) WHERE value=c.id)) RETURNING after_id`,
          )
          .bind(familyId, JSON.stringify(seen)),
      ]);
      return result[2].results[0]?.after_id ?? null;
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause;
    }
  }
  return null;
}
/** Same separate once/repeating budgets and cyclic attempted-position semantics
 * as PostgreSQL. A bounded visit never claims that every household series is full.
 */
export async function topUpD1HouseholdSeries(
  familyId: string,
  now = new Date(),
  database?: D1Store,
  clock = () => performance.now(),
): Promise<number> {
  const store = database ?? (await getD1Database());
  let inserted = 0;
  try {
    for (const root of await onceRoots(store, familyId))
      inserted += await expandD1RecurringSeries(root.id, familyId, now, store);
  } catch {
    console.warn("[chores] Scheduled once top-up could not finish");
  }
  if (isFairChoreTopUpEnabled()) {
    const deadline = clock() + FAIR_CHORE_TOP_UP_BUDGET_MS,
      seen: string[] = [];
    for (let i = 0; i < FAIR_CHORE_TOP_UP_MAX && clock() < deadline; i++) {
      let id: string | null;
      try {
        id = await claimFairRoot(store, familyId, seen);
      } catch {
        console.warn("[chores] Fair top-up claim could not finish");
        break;
      }
      if (!id || !isFairChoreTopUpEnabled() || clock() >= deadline) break;
      seen.push(id);
      try {
        inserted += await expandD1RecurringSeries(id, familyId, now, store);
      } catch {
        console.warn("[chores] Fair top-up series could not finish");
      }
    }
  } else {
    try {
      for (const root of await repeatingRoots(store, familyId, null, 100))
        inserted += await expandD1RecurringSeries(
          root.id,
          familyId,
          now,
          store,
        );
    } catch {
      console.warn("[chores] Series top-up could not finish");
    }
  }
  return inserted;
}
