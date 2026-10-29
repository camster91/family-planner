import type { DeviceActor } from "@/lib/device-session";
import { isGroceryListType } from "@/lib/grocery-display";
import { reviewFingerprint, type QueueReviewEntry } from "@/lib/queue-review-contract";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { readD1DeviceActor } from "./device-sessions";

/** Content-minimal queue recovery projection for a paired device. */
export async function reviewD1DeviceQueue(
  actor: DeviceActor,
  entries: QueueReviewEntry[],
  now = new Date(),
  database?: D1Store,
) {
  const store = database ?? (await getD1Database());
  const session = store.withSession("first-primary");
  const captured = await captureD1Reads(async (db) => {
    const access = await readD1DeviceActor(db, actor, now);
    const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true, device_writes_enabled: true } });
    const permitted = entries.filter((entry) => entry.action.startsWith("device."));
    const itemIds = permitted.flatMap((entry) => ("itemId" in entry ? [entry.itemId] : []));
    const listIds = permitted.flatMap((entry) => ("listId" in entry ? [entry.listId] : []));
    const memberIds = permitted.flatMap((entry) => ("actingMemberId" in entry ? [entry.actingMemberId] : []));
    const [items, lists, members] = await Promise.all([
      itemIds.length ? db.listItem.findMany({ where: { id: { in: itemIds }, list: { family_id: actor.familyId } }, select: { id: true, content: true, checked: true, list: { select: { id: true, name: true, type: true } } } }) : [],
      listIds.length ? db.list.findMany({ where: { id: { in: listIds }, family_id: actor.familyId }, select: { id: true, name: true, type: true } }) : [],
      memberIds.length ? db.user.findMany({ where: { id: { in: memberIds }, family_id: actor.familyId, role: { in: ["parent", "teen", "child"] } }, select: { id: true, name: true } }) : [],
    ]);
    return { access, family, permitted, items, lists, members };
  }, store as unknown as NativeD1);
  await session.batch(captured.checks(session));
  const value = captured.value;
  if (!value.access.ok) return { status: value.access.status, code: value.access.code, body: undefined };
  if (!value.family || !value.family.device_writes_enabled) return { status: 403, code: "DEVICE_WRITES_OFF", body: undefined };
  const rows = entries.map((entry) => {
    let target: {
      listId: string;
      listName: string;
      itemId: string | null;
      itemName: string | null;
      checked: boolean | null;
      actorName: string | null;
      actorId: string | null;
    } | null = null;
    const actorMember = "actingMemberId" in entry ? value.members.find((member: any) => member.id === entry.actingMemberId) : null;
    if (value.permitted.includes(entry) && actorMember) {
      if ("itemId" in entry) {
        const item = value.items.find((candidate: any) => candidate.id === entry.itemId);
        if (item && isGroceryListType(item.list.type)) target = { listId: item.list.id, listName: item.list.name, itemId: item.id, itemName: item.content, checked: item.checked, actorName: actorMember.name, actorId: actorMember.id };
      } else {
        const list = value.lists.find((candidate: any) => candidate.id === entry.listId);
        if (list && isGroceryListType(list.type)) target = { listId: list.id, listName: list.name, itemId: null, itemName: null, checked: null, actorName: actorMember.name, actorId: actorMember.id };
      }
    }
    return { id: entry.id, fingerprint: reviewFingerprint(entry), target };
  });
  return { status: 200, body: rows };
}
