import { storageBackend } from "@/lib/storage-backend";
import { CALENDAR_OWNER_PROTOCOL } from "@/lib/calendar-read-owner";
import { readD1EventNotificationFocus } from "@/lib/cloudflare/calendar-events";
/** One concrete canonical event, independent of calendar range/paging. */
import type { PrismaClient } from "@prisma/client";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
export type EventNotificationFocus = { id: string; title: string; start: string; end: string };
export async function readEventNotificationFocus(
  db: Pick<PrismaClient, "$transaction">,
  owner: { userId: string; familyId: string; role: string; tokenVersion: number },
  target: unknown,
): Promise<EventNotificationFocus | null> {
  const actor = Object.freeze({ ...owner });
  if (typeof target !== "string" || !MEMBER_ID_PATTERN.test(target) ||
    !["parent", "teen"].includes(actor.role) || !Number.isSafeInteger(actor.tokenVersion) || actor.tokenVersion < 0) return null;
  if (storageBackend() === "d1") return readD1EventNotificationFocus({ protocol: CALENDAR_OWNER_PROTOCOL,
    actorId: actor.userId, familyId: actor.familyId, role: actor.role, generation: actor.tokenVersion }, target);
  return db.$transaction(async tx => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const people = await tx.$queryRaw<Array<{ family_id: string | null; role: string; token_version: number }>>`
      SELECT "family_id", "role", "token_version" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
    const person = people[0];
    if (people.length !== 1 || person.family_id !== actor.familyId || person.role !== actor.role || person.token_version !== actor.tokenVersion) return null;
    const families = await tx.$queryRaw<Array<{ features: unknown }>>`
      SELECT "features" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
    if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "calendar")) return null;
    // A recurring master is not an exact occurrence. Do not guess its first date.
    const targets = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Event" WHERE "id" = ${target} AND "family_id" = ${actor.familyId} AND "recurrence" IS NULL FOR SHARE`;
    if (targets.length !== 1) return null;
    const row = await tx.event.findFirst({ where: { id: target, family_id: actor.familyId, recurrence: null },
      select: { id: true, title: true, start_time: true, end_time: true } });
    if (!row || !Number.isFinite(row.start_time.getTime()) || !Number.isFinite(row.end_time.getTime()) ||
      row.end_time.getTime() <= row.start_time.getTime()) return null;
    return { id: row.id, title: row.title, start: row.start_time.toISOString(), end: row.end_time.toISOString() };
  }, { timeout: 5000, maxWait: 5000 });
}
