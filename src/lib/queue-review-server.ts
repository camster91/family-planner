import type { PrismaClient } from "@prisma/client";
import { isGroceryListType } from "@/lib/grocery-display";
import {
  reviewFingerprint,
  type QueueReviewEntry,
  type QueueReviewTarget,
} from "@/lib/queue-review-contract";
/** Canonical, content-minimal read only. Missing/foreign/forbidden all become null. */
export async function reviewQueueTargets(
  db: Pick<PrismaClient, "list" | "listItem" | "user">,
  familyId: string,
  kind: "person" | "device",
  entries: QueueReviewEntry[],
) {
  const permitted = entries.filter(
    (entry) => entry.action.startsWith("device.") === (kind === "device"),
  );
  const [items, lists, members] = await Promise.all([
    db.listItem.findMany({
      where: {
        id: {
          in: permitted.flatMap((entry) =>
            "itemId" in entry ? [entry.itemId] : [],
          ),
        },
        list: { family_id: familyId },
      },
      select: {
        id: true,
        content: true,
        checked: true,
        list: { select: { id: true, name: true, type: true } },
      },
    }),
    db.list.findMany({
      where: {
        id: {
          in: permitted.flatMap((entry) =>
            "listId" in entry ? [entry.listId] : [],
          ),
        },
        family_id: familyId,
      },
      select: { id: true, name: true, type: true },
    }),
    kind === "device"
      ? db.user.findMany({
          where: {
            id: {
              in: permitted.flatMap((entry) =>
                "actingMemberId" in entry ? [entry.actingMemberId] : [],
              ),
            },
            family_id: familyId,
            role: { in: ["parent", "teen", "child"] },
          },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  return entries.map((entry) => {
    let target: QueueReviewTarget | null = null;
    const actor =
      "actingMemberId" in entry
        ? members.find((member) => member.id === entry.actingMemberId)
        : null;
    if (permitted.includes(entry) && (kind === "person" || actor)) {
      if ("itemId" in entry) {
        const item = items.find((item) => item.id === entry.itemId);
        if (item && (kind === "person" || isGroceryListType(item.list.type)))
          target = {
            listId: item.list.id,
            listName: item.list.name,
            itemId: item.id,
            itemName: item.content,
            checked: item.checked,
            actorName: actor?.name ?? null,
            actorId: actor?.id ?? null,
          };
      } else {
        const list = lists.find((list) => list.id === entry.listId);
        if (list && isGroceryListType(list.type))
          target = {
            listId: list.id,
            listName: list.name,
            itemId: null,
            itemName: null,
            checked: null,
            actorName: actor?.name ?? null,
            actorId: actor?.id ?? null,
          };
      }
    }
    return { id: entry.id, fingerprint: reviewFingerprint(entry), target };
  });
}
