/** Exact ID windows; filtered/empty windows with `next` are not whole-domain
 * empty claims. Canonical loader renews selected identities and availability. */
import type { PrismaClient } from "@prisma/client";
import { isProfileChoreEnabled } from "@/lib/chore-profile";
import {
  preparationPickerQuery,
  preparationPickerReply,
  type PreparationPickerQuery,
} from "./picker-contract";
import {
  openPreparationActorInTx,
  prepareEventPreparationInTx,
  type PreparationActor,
} from "./runtime";
import { EventPreparationError } from "./contract";
export async function readPreparationPicker(
  db: PrismaClient,
  actor: PreparationActor,
  raw: PreparationPickerQuery,
) {
  const query = preparationPickerQuery.parse(raw);
  return db.$transaction(async (tx) => {
    await openPreparationActorInTx(tx, actor);
    if (query.kind === "profiles" && !isProfileChoreEnabled())
      throw new EventPreparationError("UNAVAILABLE");
    const after = query.after ?? "";
    // Literal contains, not SQL wildcard search; all private text stays scoped.
    const search = `%${query.search.replace(/[\\%_]/g, "\\$&")}%`;
    const rows =
      query.kind === "tasks"
        ? await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT "id" FROM "Chore" WHERE "family_id"=${actor.familyId} AND "id">${after} AND "is_template"=false AND "title" ILIKE ${search} ORDER BY "id" LIMIT 21`
        : query.kind === "accounts"
          ? await tx.$queryRaw<
              Array<{ id: string }>
            >`SELECT "id" FROM "User" WHERE "family_id"=${actor.familyId} AND "id">${after} AND "role" IN ('parent','teen','child') AND "name" ILIKE ${search} ORDER BY "id" LIMIT 21`
          : query.kind === "profiles"
            ? await tx.$queryRaw<
                Array<{ id: string }>
              >`SELECT m."id" FROM "HouseholdMember" m WHERE m."family_id"=${actor.familyId} AND m."id">${after} AND m."archived_at" IS NULL AND m."erasure_user_id" IS NULL AND m."name" ILIKE ${search} AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberLegacyMapping" l WHERE l."member_id"=m."id" AND l."family_id"=m."family_id") AND NOT EXISTS (SELECT 1 FROM "HouseholdMemberAccountLink" l WHERE l."member_id"=m."id" AND l."family_id"=m."family_id") ORDER BY m."id" LIMIT 21`
            : await tx.$queryRaw<
                Array<{ id: string }>
              >`SELECT "id" FROM "RoutineStack" WHERE "family_id"=${actor.familyId} AND "id">${after} AND "label" ILIKE ${search} ORDER BY "id" LIMIT 21`;
    const ids = rows.slice(0, 20).map((row) => row.id);
    const prepared = await prepareEventPreparationInTx(tx, actor, {
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
        ? await tx.$queryRaw<
            Array<{ id: string; label: string }>
          >`SELECT "id", "label" FROM "RoutineStack" WHERE "family_id"=${actor.familyId} AND "id"=ANY(${ids}::text[]) ORDER BY "id"`
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
  });
}
