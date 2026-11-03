/** Native source acquisition for the existing preparation domain planner.
 * Every read goes through the captured read facade; the caller validates its
 * witness in one D1 batch before returning a preview or committing effects.
 */
import { isFeatureEnabled, normalizeFeatures } from "../features";
import { EventPreparationError } from "../event-preparation/contract";
import {
  preparationReadScope,
  type PreparationReadScope,
} from "../event-preparation/read-contract";
import { parsePreparationState } from "../event-preparation/state-store";
import {
  buildPreparationSource,
  type PreparationActor,
  type PreparationChoreRow,
} from "../event-preparation/runtime";
import type { D1ReadClient, NativeD1 } from "./read-client";
import { captureD1Reads } from "./read-witness";
import { getD1Database, type D1Store } from "./database";
import { d1EventPreparationStorageAvailable } from "./chore-read-policy";
import { isD1WriteConflict } from "./write-check";
const unique = (ids: string[]) => [...new Set(ids)].sort();
async function boundedIds<T extends { id: string }>(
  ids: string[],
  read: (ids: string[]) => Promise<T[]>,
) {
  const rows: T[] = [];
  for (let offset = 0; offset < ids.length; offset += 75)
    rows.push(...(await read(ids.slice(offset, offset + 75))));
  return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export async function authorizeD1PreparationActor(
  db: D1ReadClient,
  actor: PreparationActor,
) {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, family_id: true, role: true, token_version: true },
  });
  if (!user || user.token_version !== actor.tokenVersion)
    throw new EventPreparationError("UNAUTHORIZED");
  if (user.family_id !== actor.familyId || user.role !== "parent")
    throw new EventPreparationError("FORBIDDEN");
  const family = await db.family.findUnique({
    where: { id: actor.familyId },
    select: { features: true },
  });
  if (!family) throw new EventPreparationError("FORBIDDEN");
  const features = normalizeFeatures(family.features);
  return {
    features,
    domainsEnabled:
      isFeatureEnabled(features, "calendar") &&
      isFeatureEnabled(features, "chores"),
  };
}
export async function loadD1PreparationSource(
  db: D1ReadClient,
  actor: PreparationActor,
  raw: PreparationReadScope,
) {
  const scope = preparationReadScope.parse(raw);
  const { features, domainsEnabled } = await authorizeD1PreparationActor(
    db,
    actor,
  );
  if (!domainsEnabled) throw new EventPreparationError("FORBIDDEN");
  const plans = await db.eventPreparation.findMany({
    where: { family_id: actor.familyId, event_id: scope.eventId },
    take: 2,
  });
  const links = plans[0]
    ? await db.eventPreparationStep.findMany({
        where: { family_id: actor.familyId, preparation_id: plans[0].id },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        take: 100,
      })
    : [];
  const state = parsePreparationState(plans, links);
  const initialRoutineIds = scope.routine
    ? await db.chore.findMany({
        where: {
          family_id: actor.familyId,
          routine_stack_id: scope.routine.stackId,
          due_date: new Date(`${scope.routine.occurrenceDay}T00:00:00.000Z`),
          is_template: false,
        },
        orderBy: [
          { routine_order: { sort: "asc", nulls: "last" } },
          { id: "asc" },
        ],
        select: { id: true },
        take: 100,
      })
    : [];
  if (initialRoutineIds.length > 99)
    throw new EventPreparationError("UNAVAILABLE");
  const selectedIds = unique([
    ...scope.choreIds,
    ...(state?.links.map((row) => row.choreId) ?? []),
    ...initialRoutineIds.map((row) => row.id),
  ]);
  if (selectedIds.length > 500) throw new EventPreparationError("UNAVAILABLE");
  const selected = await boundedIds(selectedIds, (ids) =>
    db.chore.findMany({
      where: { family_id: actor.familyId, id: { in: ids } },
    }),
  );
  const allIds = unique([
    ...selectedIds,
    ...selected.flatMap((row) =>
      row.recurrence_id ? [row.recurrence_id] : [],
    ),
  ]);
  const chores = await boundedIds(allIds, (ids) =>
    db.chore.findMany({
      where: { family_id: actor.familyId, id: { in: ids } },
    }),
  );
  if (
    chores.some(
      (row) => row.recurrence_id && !allIds.includes(row.recurrence_id),
    )
  )
    throw new EventPreparationError("UNAVAILABLE");
  const userIds = unique([
    actor.userId,
    ...chores.flatMap((row) => (row.assigned_to ? [row.assigned_to] : [])),
    ...scope.subjects.flatMap((subject) =>
      subject.kind === "account" ? [subject.accountId] : [],
    ),
  ]);
  const memberIds = unique([
    ...chores.flatMap((row) =>
      row.assigned_member_id ? [row.assigned_member_id] : [],
    ),
    ...scope.subjects.flatMap((subject) =>
      subject.kind === "profile" ? [subject.memberId] : [],
    ),
  ]);
  const users = await boundedIds(userIds, (ids) =>
    db.user.findMany({
      where: { family_id: actor.familyId, id: { in: ids } },
      select: {
        id: true,
        family_id: true,
        name: true,
        role: true,
        token_version: true,
        created_at: true,
      },
    }),
  );
  const me = users.find((user) => user.id === actor.userId);
  if (!me || me.token_version !== actor.tokenVersion)
    throw new EventPreparationError("UNAUTHORIZED");
  if (me.role !== "parent") throw new EventPreparationError("FORBIDDEN");
  const profiles = await boundedIds(memberIds, (ids) =>
    db.householdMember.findMany({
      where: { family_id: actor.familyId, id: { in: ids } },
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
    }),
  );
  const stackIds = unique([
    ...chores.flatMap((row) =>
      row.routine_stack_id ? [row.routine_stack_id] : [],
    ),
    ...(scope.routine ? [scope.routine.stackId] : []),
  ]);
  const stacks = await boundedIds(stackIds, (ids) =>
    db.routineStack.findMany({
      where: { family_id: actor.familyId, id: { in: ids } },
      select: { id: true, label: true, version: true, fingerprint: true },
    }),
  );
  const event = await db.event.findFirst({
    where: { id: scope.eventId, family_id: actor.familyId },
  });
  if (!event) throw new EventPreparationError("NOT_FOUND");
  const attachedRows = await boundedIds(selectedIds, (ids) =>
    db.eventPreparationStep.findMany({
      where: { family_id: actor.familyId, chore_id: { in: ids } },
      select: {
        id: true,
        chore_id: true,
        preparation: { select: { event_id: true } },
      },
    }),
  );
  const rows: PreparationChoreRow[] = chores.map((row) => {
    const root = chores.find((candidate) => candidate.id === row.recurrence_id);
    return {
      ...row,
      generation: row.responsibility_generation,
      epoch: row.responsibility_epoch,
      no_series_config: row.routine_series_config === null,
      own_config: row.routine_series_config,
      root_id: root?.id ?? null,
      root_recurrence_id: root?.recurrence_id ?? null,
      root_generation: root?.responsibility_generation ?? null,
      root_epoch: root?.responsibility_epoch ?? null,
      series_config: root?.routine_series_config ?? null,
    };
  });
  return buildPreparationSource({
    actor,
    scope,
    selectedIds,
    initialRoutineIds,
    users,
    profiles,
    rows,
    stacks,
    event: {
      ...event,
      generation: event.schedule_generation,
      epoch: event.schedule_epoch,
    },
    state,
    attached: attachedRows.map((row) => ({
      chore_id: row.chore_id,
      event_id: row.preparation.event_id,
    })),
    features,
  });
}
export async function readD1PreparationSource(
  actor: PreparationActor,
  scope: PreparationReadScope,
  database?: D1Store,
) {
  const db = database ?? (await getD1Database());
  if (!(await d1EventPreparationStorageAvailable(db)))
    throw new EventPreparationError("UNAVAILABLE");
  return validatedD1PreparationRead(
    (client) => loadD1PreparationSource(client, actor, scope),
    db,
  );
}

/** Validate all acquisition reads together before disclosing private results. */
export async function validatedD1PreparationRead<T>(
  readSource: (client: D1ReadClient) => Promise<T>,
  database?: D1Store,
): Promise<T> {
  const db = database ?? (await getD1Database());
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await captureD1Reads(readSource, db as unknown as NativeD1);
    try {
      await db.withSession("first-primary").batch(read.checks(db));
      return read.value;
    } catch (error) {
      if (!isD1WriteConflict(error)) throw error;
    }
  }
  throw new EventPreparationError("STALE");
}
