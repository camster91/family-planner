/** Canonical routine top-up. Caller holds the household lock; no second store. */
import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  routineStepSeriesConfig,
  routineScheduleConfig,
  firstRoutineOccurrence,
  nextRoutineOccurrence,
  type RoutineStepSeriesConfig,
} from "@/lib/routine-schedule";
import { isRoutineScheduleExpansionEnabled } from "@/lib/routine-schedule-gates";
import { eligibleChoreAssigneeInTx } from "@/lib/chore-member-subject";
import { eligibleProfileChoreAssigneeInTx } from "@/lib/chore-profile-assignee";

/** Bounded date-only window. Retained off-schedule evidence never suppresses a slot. */
export function routineExpansionDays(
  definition: RoutineStepSeriesConfig,
  today: string,
): string[] {
  const value = routineStepSeriesConfig.parse(definition);
  if (value.state !== "active") return [];
  const schedule = value.schedule;
  const floor = [today, value.effective_on].sort().at(-1)!;
  // Once means its reviewed day, never a fresh task on every later page load.
  if (schedule.frequency === "once") {
    const reviewedDay = [schedule.starts_on!, value.effective_on]
      .sort()
      .at(-1)!;
    return reviewedDay < today ? [] : [reviewedDay];
  }
  const size =
    schedule.frequency === "daily"
      ? 7
      : schedule.frequency === "weekly"
        ? 4 * schedule.weekly_days.length
        : schedule.frequency === "monthly"
          ? 3
          : 1;
  const days: string[] = [];
  let cursor: string | null = firstRoutineOccurrence(schedule, today, floor);
  while (cursor && days.length < size) {
    days.push(cursor);
    cursor = nextRoutineOccurrence(schedule, cursor);
  }
  return days;
}

type Root = {
  id: string;
  family_id: string;
  recurrence_id: string | null;
  created_by: string;
  member_subject_erased: boolean;
};
export async function expandRoutineScheduleInTx(
  tx: Prisma.TransactionClient,
  root: Root,
  raw: unknown,
  today: string,
): Promise<number> {
  if (!isRoutineScheduleExpansionEnabled() || root.recurrence_id !== root.id)
    return 0;
  const parsed = routineStepSeriesConfig.safeParse(raw);
  // Unknown versions hold, rather than falling back to historical root fields.
  if (!parsed.success || parsed.data.state !== "active") return 0;
  const definition = parsed.data;
  let label: string | null = null,
    order: number | null = null;
  if (definition.stack_id) {
    const stacks = await tx.$queryRaw<
      { label: string; schedule_config: unknown }[]
    >`
      SELECT "label", "schedule_config" FROM "RoutineStack"
      WHERE "id" = ${definition.stack_id} AND "family_id" = ${root.family_id}`;
    if (stacks.length !== 1) return 0;
    const stack = routineScheduleConfig.safeParse(stacks[0].schedule_config);
    if (
      !stack.success ||
      stack.data.state !== definition.state ||
      stack.data.effective_on !== definition.effective_on ||
      stack.data.anchor !== definition.anchor ||
      JSON.stringify(stack.data.schedule) !==
        JSON.stringify(definition.schedule)
    )
      return 0;
    const index = stack.data.steps.findIndex(
      (step) => step.template_id === root.id,
    );
    if (index < 0) return 0;
    label = stacks[0].label;
    order = index + 1;
  }
  const subject = definition.content.subject;
  if (subject.kind === "erased") return 0;
  const assignee =
    subject.kind === "profile"
      ? await eligibleProfileChoreAssigneeInTx(
          tx,
          root.family_id,
          subject.member_id,
          definition.schedule.frequency !== "once",
        )
      : await eligibleChoreAssigneeInTx(tx, root.family_id, subject.user_id, {
          requireCanonical: subject.member_id !== null,
        });
  if (
    !assignee ||
    (subject.kind === "account" &&
      subject.member_id !== null &&
      assignee.assigned_member_id !== subject.member_id)
  )
    return 0;
  const days = routineExpansionDays(definition, today);
  if (!days.length) return 0;
  const existing = await tx.chore.findMany({
    where: {
      family_id: root.family_id,
      recurrence_id: root.id,
      due_date: { in: days.map((day) => new Date(`${day}T00:00:00.000Z`)) },
    },
    select: { due_date: true },
  });
  const occupied = new Set(
    existing.map((row) => row.due_date.toISOString().slice(0, 10)),
  );
  const content = definition.content;
  const copies = days
    .filter((day) => !occupied.has(day))
    .map((day) => ({
      id: crypto.randomUUID(),
      family_id: root.family_id,
      created_by: root.created_by,
      title: content.title,
      description: content.description,
      points: content.points,
      difficulty: content.difficulty,
      icon: content.icon,
      ...assignee,
      member_subject_erased: false,
      rotation_index: null,
      frequency: "once",
      due_date: new Date(`${day}T00:00:00.000Z`),
      status: "pending",
      recurrence_id: root.id,
      is_template: false,
      routine_stack_id: definition.stack_id,
      routine: label,
      routine_order: order,
    }));
  if (!copies.length) return 0;
  const inserted = await tx.chore.createMany({
    data: copies,
    skipDuplicates: true,
  });
  // Nullable additive fields use raw SQL until the staged client is regenerated
  // during consolidated QA. Only this attempt's new IDs receive snapshots.
  const ids = copies.map((copy) => copy.id);
  await tx.$executeRaw`UPDATE "Chore" SET "routine_anchor" = ${definition.anchor}, "routine_duration_minutes" = ${content.duration_minutes}
    WHERE "family_id" = ${root.family_id} AND "recurrence_id" = ${root.id} AND "id" = ANY(${ids}::text[])`;
  return inserted.count;
}
