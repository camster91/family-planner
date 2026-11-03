/** Bounded discovery windows; canonical source reads renew every selected item. */
import {
  preparationPickerQuery,
  preparationPickerReply,
  type PreparationPickerQuery,
} from "../event-preparation/picker-contract";
import type { PreparationActor } from "../event-preparation/runtime";
import { EventPreparationError } from "../event-preparation/contract";
import { isProfileChoreEnabled } from "../profile-chore-gates";
import {
  loadD1PreparationSource,
  validatedD1PreparationRead,
} from "./preparation-source";
import { getD1Database, type D1Store } from "./database";
import { d1EventPreparationStorageAvailable } from "./chore-read-policy";

export async function readD1PreparationPicker(
  actor: PreparationActor,
  raw: PreparationPickerQuery,
  database?: D1Store,
) {
  const query = preparationPickerQuery.parse(raw),
    store = database ?? (await getD1Database());
  if (
    !(await d1EventPreparationStorageAvailable(store)) ||
    (query.kind === "profiles" && !isProfileChoreEnabled())
  )
    throw new EventPreparationError("UNAVAILABLE");
  const source =
    query.kind === "tasks"
      ? { table: "Chore", label: "title", filter: "m.is_template=0" }
      : query.kind === "accounts"
        ? {
            table: "User",
            label: "name",
            filter: "m.role IN ('parent','teen','child')",
          }
        : query.kind === "profiles"
          ? {
              table: "HouseholdMember",
              label: "name",
              filter: `m.archived_at IS NULL AND m.erasure_user_id IS NULL AND NOT EXISTS(SELECT 1 FROM HouseholdMemberLegacyMapping l WHERE l.member_id=m.id AND l.family_id=m.family_id) AND NOT EXISTS(SELECT 1 FROM HouseholdMemberAccountLink l WHERE l.member_id=m.id AND l.family_id=m.family_id)`,
            }
          : { table: "RoutineStack", label: "label", filter: "1=1" };
  // Only source-owned identifiers are interpolated. instr treats %, _ and \\ as
  // ordinary text. This discovery read never returns private labels to callers.
  const window = await store
    .withSession("first-primary")
    .prepare(
      `SELECT m.id FROM ${source.table} m WHERE m.family_id=?1 AND m.id>?2 AND instr(lower(m.${source.label}),lower(?3))>0 AND ${source.filter} AND EXISTS(SELECT 1 FROM User u WHERE u.id=?4 AND u.family_id=m.family_id AND u.role='parent' AND u.token_version=?5) ORDER BY m.id LIMIT 21`,
    )
    .bind(
      actor.familyId,
      query.after ?? "",
      query.search,
      actor.userId,
      actor.tokenVersion,
    )
    .all<{ id: string }>();
  const rows = window.results ?? [],
    ids = rows.slice(0, 20).map((row) => row.id);
  return validatedD1PreparationRead(async (db) => {
    const prepared = await loadD1PreparationSource(db, actor, {
      eventId: query.eventId,
      timeZone: query.timeZone,
      memberProtocol: 2,
      choreIds: query.kind === "tasks" ? ids : [],
      subjects:
        query.kind === "accounts"
          ? ids.map((accountId) => ({ kind: "account", accountId }))
          : query.kind === "profiles"
            ? ids.map((memberId) => ({ kind: "profile", memberId }))
            : [],
      routine: null,
    });
    let items: ReturnType<typeof preparationPickerReply.parse>["items"];
    if (query.kind === "tasks")
      items = prepared.tasks
        .filter(
          (detail) =>
            ids.includes(detail.task.id) &&
            detail.task.linkable &&
            (!detail.task.attachedEventId ||
              detail.task.attachedEventId === query.eventId),
        )
        .map((detail) => ({
          kind: "task",
          id: detail.task.id,
          title: detail.title!,
          dueDay: detail.task.dueDay,
          subjectName: detail.subjectName!,
        }));
    else if (query.kind === "routines") {
      const stacks = ids.length
        ? await db.routineStack.findMany({
            where: { family_id: actor.familyId, id: { in: ids } },
            select: { id: true, label: true },
            orderBy: { id: "asc" },
          })
        : [];
      items = stacks.map((stack) => ({
        kind: "routine",
        id: stack.id,
        label: Array.from(stack.label.normalize("NFC")).slice(0, 40).join(""),
      }));
    } else
      items = prepared.subjects
        .filter((row) =>
          row.subject.kind === "account"
            ? query.kind === "accounts" && ids.includes(row.subject.accountId)
            : query.kind === "profiles" && ids.includes(row.subject.memberId),
        )
        .map((row) => ({
          kind: "person",
          id:
            row.subject.kind === "account"
              ? row.subject.accountId
              : row.subject.memberId,
          ...row,
        }));
    return preparationPickerReply.parse({
      owner: { userId: actor.userId, familyId: actor.familyId },
      eventId: query.eventId,
      kind: query.kind,
      search: query.search,
      after: query.after ?? null,
      next: rows.length > 20 ? ids.at(-1) : null,
      items,
    });
  }, store);
}
