/** Person-parent preparation source. Never authenticate a profile/device as a
 * person. Source collection is bounded; fresh dependencies are discovered before
 * locks and rechecked afterward, rather than acquiring late identity/root locks. */
import type { Prisma } from "@prisma/client";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import {
  readChoreSubject,
  profileChoreActionAvailability,
  isProfileChoreEnabled,
} from "@/lib/chore-profile";
import {
  routineOccurrencePolicy,
  type RoutineOccurrenceSnapshot,
} from "@/lib/routine-occurrence-policy";
import {
  scheduleEventToken,
  scheduleStorageAvailable,
} from "@/lib/calendar-planning/schedule-source";
import {
  EventPreparationError,
  preparationStepContent,
  type PreparationContext,
  type PreparationTask,
} from "./contract";
import {
  preparationReadScope,
  type PreparationReadScope,
} from "./read-contract";
import { eventPreparationStorageAvailable } from "./storage";
import { eventPreparationWritingEnabled } from "./owner";
import { readPreparationStateInTx, preparationStateToken } from "./state-store";
import { preparationScopeToken } from "./scope";
import { preparationTaskToken, preparationRoutineToken } from "./source";
import { createHash } from "node:crypto";
export type PreparationActor = {
  userId: string;
  familyId: string;
  tokenVersion: number;
};
type UserRow = {
  id: string;
  family_id: string | null;
  name: string;
  role: string;
  token_version: number;
  created_at: Date;
};
type ChoreRow = RoutineOccurrenceSnapshot & {
  family_id: string;
  title: string;
  description: string | null;
  points: number;
  assigned_to: string | null;
  assigned_member_id: string | null;
  frequency: string;
  is_template: boolean;
  difficulty: string;
  icon: string | null;
  routine_order: number | null;
  routine_duration_minutes: number | null;
  routine_stack_id: string | null;
  generation: string;
  epoch: number;
  preparation_epoch: number;
  no_series_config: boolean;
  root_generation: string | null;
  root_epoch: number | null;
};
const text = (value: string, max = 200) =>
  Array.from(value.normalize("NFC")).slice(0, max).join("");
const unique = (values: string[]) => [...new Set(values)].sort();
const refs = (rows: ChoreRow[]) => ({
  users: rows.flatMap((row) => (row.assigned_to ? [row.assigned_to] : [])),
  profiles: rows.flatMap((row) =>
    row.assigned_member_id ? [row.assigned_member_id] : [],
  ),
});
function dependencyToken(rows: ChoreRow[]) {
  return JSON.stringify(
    [...rows]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((row) => [
        row.id,
        row.assigned_to,
        row.assigned_member_id,
        row.recurrence_id,
        row.routine_stack_id,
      ]),
  );
}
async function readChores(
  tx: Prisma.TransactionClient,
  familyId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  return tx.$queryRaw<ChoreRow[]>`
    SELECT c."id", c."family_id", c."title", c."description", c."points", c."assigned_to", c."assigned_member_id",
      c."due_date", c."status", c."frequency", c."is_template", c."difficulty", c."icon", c."routine_order",
      c."routine_duration_minutes", c."routine_stack_id", c."recurrence_id", c."member_subject_erased",
      c."photo_url", c."photo_verified", c."verified_at", c."verified_notes", c."completed_at", c."successor_id",
      c."responsibility_generation" AS generation, c."responsibility_epoch" AS epoch, c."preparation_epoch",
      (c."routine_series_config" IS NULL) AS no_series_config, c."routine_series_config" AS own_config, r."id" AS root_id, r."recurrence_id" AS root_recurrence_id,
      r."responsibility_generation" AS root_generation, r."responsibility_epoch" AS root_epoch,
      r."routine_series_config" AS series_config
    FROM "Chore" c LEFT JOIN "Chore" r ON r."id"=c."recurrence_id" AND r."family_id"=c."family_id"
    WHERE c."family_id"=${familyId} AND c."id"=ANY(${ids}::text[]) ORDER BY c."id"`;
}
async function routineIds(
  tx: Prisma.TransactionClient,
  familyId: string,
  scope: PreparationReadScope,
) {
  if (!scope.routine) return [];
  return tx.$queryRaw<
    Array<{ id: string }>
  >`SELECT "id" FROM "Chore" WHERE "family_id"=${familyId}
    AND "routine_stack_id"=${scope.routine.stackId} AND "due_date"=${new Date(`${scope.routine.occurrenceDay}T00:00:00.000Z`)}
    AND "is_template"=false ORDER BY "routine_order" ASC NULLS LAST, "id" ASC LIMIT 100`;
}
/** Starts authorization and serializes canonical household services. Row-level
 * actor renewal happens with the full sorted user set, before Chore/Event locks. */
export async function openPreparationActorInTx(
  tx: Prisma.TransactionClient,
  actor: PreparationActor,
) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const user = await tx.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    throw new EventPreparationError("UNAUTHORIZED");
  if (user.family_id !== actor.familyId || user.role !== "parent")
    throw new EventPreparationError("FORBIDDEN");
}
/** Caller starts openPreparationActorInTx. This function intentionally does not
 * run as independent authority. Fresh preview and mutation use the same loader.
 * Selection is exact: refresh after adding/removing picker sources before save. */
export async function prepareEventPreparationInTx(
  tx: Prisma.TransactionClient,
  actor: PreparationActor,
  rawScope: PreparationReadScope,
) {
  const scope = preparationReadScope.parse(rawScope);
  if (
    !(await eventPreparationStorageAvailable(tx)) ||
    !(await scheduleStorageAvailable(tx))
  )
    throw new EventPreparationError("UNAVAILABLE");
  const before = await readPreparationStateInTx(
    tx,
    actor.familyId,
    scope.eventId,
  );
  const initialRoutineIds = await routineIds(tx, actor.familyId, scope);
  if (initialRoutineIds.length > 99)
    throw new EventPreparationError("UNAVAILABLE");
  const selectedIds = unique([
    ...scope.choreIds,
    ...(before?.links.map((row) => row.choreId) ?? []),
    ...initialRoutineIds.map((row) => row.id),
  ]);
  if (selectedIds.length > 500) throw new EventPreparationError("UNAVAILABLE");
  const selected = await readChores(tx, actor.familyId, selectedIds);
  const lockIds = unique([
    ...selectedIds,
    ...selected.flatMap((row) =>
      row.recurrence_id ? [row.recurrence_id] : [],
    ),
  ]);
  const initial = await readChores(tx, actor.familyId, lockIds);
  // A root may not recursively point to an undiscovered root.
  if (
    initial.some(
      (row) => row.recurrence_id && !lockIds.includes(row.recurrence_id),
    )
  )
    throw new EventPreparationError("UNAVAILABLE");
  const sourceRefs = refs(initial);
  const userIds = unique([
    actor.userId,
    ...sourceRefs.users,
    ...scope.subjects.flatMap((subject) =>
      subject.kind === "account" ? [subject.accountId] : [],
    ),
  ]);
  const memberIds = unique([
    ...sourceRefs.profiles,
    ...scope.subjects.flatMap((subject) =>
      subject.kind === "profile" ? [subject.memberId] : [],
    ),
  ]);
  const users = await tx.$queryRaw<
    UserRow[]
  >`SELECT "id", "family_id", "name", "role", "token_version", "created_at" FROM "User" WHERE "family_id"=${actor.familyId} AND "id"=ANY(${userIds}::text[]) ORDER BY "id" FOR SHARE`;
  const me = users.find((user) => user.id === actor.userId);
  if (!me || me.token_version !== actor.tokenVersion)
    throw new EventPreparationError("UNAUTHORIZED");
  if (me.role !== "parent") throw new EventPreparationError("FORBIDDEN");
  if (memberIds.length)
    await tx.$queryRaw`SELECT "id" FROM "HouseholdMember" WHERE "family_id"=${actor.familyId} AND "id"=ANY(${memberIds}::text[]) ORDER BY "id" FOR UPDATE`;
  const family = await tx.$queryRaw<
    Array<{ features: unknown }>
  >`SELECT "features" FROM "Family" WHERE "id"=${actor.familyId} FOR SHARE`;
  if (!family[0]) throw new EventPreparationError("FORBIDDEN");
  const features = normalizeFeatures(family[0].features);
  if (
    !isFeatureEnabled(features, "calendar") ||
    !isFeatureEnabled(features, "chores")
  )
    throw new EventPreparationError("FORBIDDEN");
  const stackIds = unique([
    ...initial.flatMap((row) =>
      row.routine_stack_id ? [row.routine_stack_id] : [],
    ),
    ...(scope.routine ? [scope.routine.stackId] : []),
  ]);
  const stacks = stackIds.length
    ? await tx.$queryRaw<
        Array<{
          id: string;
          label: string;
          version: number;
          fingerprint: string;
        }>
      >`SELECT "id", "label", "version", "fingerprint" FROM "RoutineStack" WHERE "family_id"=${actor.familyId} AND "id"=ANY(${stackIds}::text[]) ORDER BY "id" FOR UPDATE`
    : [];
  if (lockIds.length)
    await tx.$queryRaw`SELECT "id" FROM "Chore" WHERE "family_id"=${actor.familyId} AND "id"=ANY(${lockIds}::text[]) ORDER BY "id" FOR UPDATE`;
  const rows = await readChores(tx, actor.familyId, lockIds);
  if (dependencyToken(initial) !== dependencyToken(rows))
    throw new EventPreparationError("STALE");
  const events = await tx.$queryRaw<
    Array<{
      id: string;
      family_id: string;
      title: string;
      start_time: Date;
      end_time: Date;
      generation: string;
      epoch: number;
      preparation_epoch: number;
      recurrence: unknown;
    }>
  >`SELECT "id", "family_id", "title", "start_time", "end_time", "schedule_generation" AS generation, "schedule_epoch" AS epoch, "preparation_epoch", "recurrence" FROM "Event" WHERE "family_id"=${actor.familyId} AND "id"=${scope.eventId} FOR UPDATE`;
  const event = events[0];
  if (!event) throw new EventPreparationError("NOT_FOUND");
  const state = await readPreparationStateInTx(
    tx,
    actor.familyId,
    scope.eventId,
    true,
  );
  if (preparationStateToken(before) !== preparationStateToken(state))
    throw new EventPreparationError("STALE");
  const afterRoutineIds = await routineIds(tx, actor.familyId, scope);
  if (JSON.stringify(initialRoutineIds) !== JSON.stringify(afterRoutineIds))
    throw new EventPreparationError("STALE");
  const profiles = memberIds.length
    ? await tx.householdMember.findMany({
        where: { id: { in: memberIds }, family_id: actor.familyId },
        select: {
          id: true,
          family_id: true,
          name: true,
          role: true,
          age: true,
          revision: true,
          created_at: true,
          archived_at: true,
          erasure_user_id: true,
          legacy_mapping: { select: { user_id: true } },
          account_link: { select: { user_id: true } },
        },
      })
    : [];
  const eligibleUsers = users.filter((user) =>
    ["parent", "teen", "child"].includes(user.role),
  );
  const profileGate = scope.memberProtocol === 2 && isProfileChoreEnabled();
  const eligibleProfiles = profileGate
    ? profiles.filter((profile) => {
        const role = profileRoleSchema.safeParse(profile.role);
        return (
          profile.archived_at === null &&
          profile.erasure_user_id === null &&
          profile.legacy_mapping === null &&
          profile.account_link === null &&
          role.success &&
          isProfileAgeAllowed(role.data, profile.age)
        );
      })
    : [];
  const eligibleSubjects: PreparationContext["eligibleSubjects"] = [
    ...eligibleUsers.map((user) => ({
      kind: "account" as const,
      accountId: user.id,
    })),
    ...eligibleProfiles.map((profile) => ({
      kind: "profile" as const,
      memberId: profile.id,
    })),
  ];
  const attached = selectedIds.length
    ? await tx.$queryRaw<
        Array<{ chore_id: string; event_id: string }>
      >`SELECT s."chore_id", p."event_id" FROM "EventPreparationStep" s JOIN "EventPreparation" p ON p."id"=s."preparation_id" AND p."family_id"=s."family_id" WHERE s."family_id"=${actor.familyId} AND s."chore_id"=ANY(${selectedIds}::text[])`
    : [];
  const taskRows = rows.filter((row) => selectedIds.includes(row.id));
  const details = taskRows.map((row) => {
    const withSubjects = {
      ...row,
      assignee: users.find((user) => user.id === row.assigned_to) ?? null,
      assigneeMember:
        profiles.find((profile) => profile.id === row.assigned_member_id) ??
        null,
    };
    const currentSubject = readChoreSubject(withSubjects, actor.familyId);
    const subject =
      currentSubject?.kind === "account"
        ? { kind: "account" as const, accountId: currentSubject.accountId }
        : currentSubject?.kind === "profile" && profileGate
          ? { kind: "profile" as const, memberId: currentSubject.memberId }
          : null;
    const policy = routineOccurrencePolicy(row);
    const validStatus = [
      "pending",
      "in_progress",
      "overdue",
      "completed",
      "verified",
    ].includes(row.status);
    const available =
      !!subject &&
      eligibleSubjects.some((eligible) =>
        eligible.kind === "account"
          ? subject.kind === "account" &&
            eligible.accountId === subject.accountId
          : subject.kind === "profile" &&
            eligible.memberId === subject.memberId,
      ) &&
      validStatus &&
      !row.is_template &&
      !["inactive", "unsupported"].includes(policy) &&
      profileChoreActionAvailability(withSubjects, policy)?.state !==
        "paused" &&
      (!row.routine_stack_id ||
        stacks.some((stack) => stack.id === row.routine_stack_id));
    const task: PreparationTask = {
      id: row.id,
      sourceToken: preparationTaskToken(actor.familyId, row.id, {
        generation: row.generation,
        epoch: row.epoch,
        preparationEpoch: row.preparation_epoch,
        recurrence_id: row.recurrence_id,
        root_generation: row.root_generation,
        root_epoch: row.root_epoch,
      }),
      dueDay: row.due_date.toISOString().slice(0, 10),
      subject,
      status: validStatus
        ? (row.status as PreparationTask["status"])
        : "pending",
      attachedEventId:
        attached.find((link) => link.chore_id === row.id)?.event_id ?? null,
      linkable: available,
      dateEditable:
        available &&
        row.frequency === "once" &&
        row.recurrence_id === null &&
        row.no_series_config &&
        row.due_date.toISOString() ===
          `${row.due_date.toISOString().slice(0, 10)}T00:00:00.000Z` &&
        row.routine_stack_id === null &&
        row.successor_id === null &&
        ["pending", "overdue"].includes(row.status) &&
        row.photo_url === null &&
        !row.photo_verified &&
        row.verified_at === null &&
        row.verified_notes === null &&
        row.completed_at === null,
    };
    // Unavailable subjects do not expose old private task text in this view.
    return {
      task,
      title: available ? text(row.title) : null,
      description:
        available && row.description ? text(row.description, 1000) : null,
      subjectName: available ? text(currentSubject!.name) : null,
      row,
    };
  });
  const sourceStack = scope.routine
    ? stacks.find((stack) => stack.id === scope.routine!.stackId)
    : null;
  const routineSteps = initialRoutineIds
    .map((item) => details.find((detail) => detail.task.id === item.id))
    .filter((detail): detail is (typeof details)[number] => !!detail);
  const copiedSteps = routineSteps.map((detail) => {
    const content = preparationStepContent.safeParse({
      title: detail.row.title,
      description: detail.row.description,
      subject: detail.task.subject,
      points: detail.row.points,
      difficulty: detail.row.difficulty,
      icon: detail.row.icon,
      durationMinutes: detail.row.routine_duration_minutes,
    });
    return {
      id: detail.task.id,
      sourceToken: detail.task.sourceToken,
      copyable: detail.task.linkable && content.success,
      content: detail.task.linkable && content.success ? content.data : null,
    };
  });
  const routine =
    scope.routine && sourceStack
      ? {
          id: sourceStack.id,
          sourceToken: preparationRoutineToken({
            familyId: actor.familyId,
            stackId: sourceStack.id,
            version: sourceStack.version,
            fingerprint: sourceStack.fingerprint,
            occurrenceDay: scope.routine.occurrenceDay,
            complete:
              routineSteps.length === initialRoutineIds.length &&
              routineSteps.length > 0,
            steps: copiedSteps.map(({ id, sourceToken, copyable }) => ({
              id,
              sourceToken,
              copyable,
            })),
          }),
          occurrenceDay: scope.routine.occurrenceDay,
          complete:
            routineSteps.length === initialRoutineIds.length &&
            routineSteps.length > 0,
          steps: copiedSteps,
        }
      : null;
  const context: PreparationContext = {
    actor: {
      kind: "person",
      userId: actor.userId,
      familyId: actor.familyId,
      role: "parent",
      memberProtocol: scope.memberProtocol,
    },
    event: {
      id: event.id,
      familyId: actor.familyId,
      sourceToken: scheduleEventToken(actor.familyId, event),
      start: event.start_time.toISOString(),
      end: event.end_time.toISOString(),
      active: event.recurrence === null,
    },
    timeZone: scope.timeZone,
    viewToken: "",
    writesEnabled: eventPreparationWritingEnabled(),
    pointsEnabled: isFeatureEnabled(features, "gamification"),
    profileWritesEnabled: profileGate,
    complete: taskRows.length === selectedIds.length,
    current: state
      ? {
          reviewedEventSourceToken: state.reviewedEventSourceToken,
          links: state.links.map((link) => ({
            choreId: link.choreId,
            cue: link.cue,
          })),
        }
      : null,
    eligibleSubjects,
    tasks: details.map((detail) => detail.task),
    routine,
  };
  const token = preparationScopeToken(context, {
    eventGeneration: event.generation,
    eventEpoch: event.epoch,
    preparationEpoch: event.preparation_epoch,
    plan: state ? { id: state.id, revision: state.revision } : null,
  });
  // Extra internal continuity binds exact link-row IDs and normalized selection;
  // no client can substitute an arbitrary viewToken as server authority.
  context.viewToken = createHash("sha256")
    .update(
      JSON.stringify([
        token,
        preparationStateToken(state),
        users.map((user) => [
          user.id,
          user.role,
          user.token_version,
          user.name,
          user.created_at.toISOString(),
        ]),
        profiles
          .map((profile) => [
            profile.id,
            profile.revision,
            profile.created_at.toISOString(),
            profile.name,
            profile.role,
            profile.age,
            profile.archived_at?.toISOString() ?? null,
            profile.erasure_user_id,
            profile.legacy_mapping?.user_id ?? null,
            profile.account_link?.user_id ?? null,
          ])
          .sort((a, b) =>
            String(a[0]) < String(b[0])
              ? -1
              : String(a[0]) > String(b[0])
                ? 1
                : 0,
          ),
      ]),
    )
    .digest("hex");
  return {
    context,
    state,
    scope,
    eventTitle: text(event.title, 240),
    tasks: details.map(({ row, ...detail }) => detail),
    routineLabel: sourceStack ? text(sourceStack.label, 40) : null,
    subjects: eligibleSubjects.map((subject) => ({
      subject,
      name: text(
        subject.kind === "account"
          ? users.find((user) => user.id === subject.accountId)!.name
          : profiles.find((profile) => profile.id === subject.memberId)!.name,
      ),
    })),
  };
}
