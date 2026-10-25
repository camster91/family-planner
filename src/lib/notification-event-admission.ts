/** N1 internal admission only: no current producer/endpoint or dispatch call.
 * The caller owns one canonical domain transaction and its exact effect receipt.
 * Required sourceGuard must lock/recheck canonical generation, accepted transition,
 * role/feature and source authority in this SAME transaction, not a cached DTO.
 */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import {
  notificationEventEnvelope, notificationOccurrenceIdentity,
  compareNotificationOccurrence, notificationDispatchWindowOpen,
  type NotificationEventEnvelope,
} from "@/lib/notification-event-contract";

export type NotificationEventActor = { userId: string; familyId: string; role: string; tokenVersion: number };
export function notificationEventAdmissionEnabled() {
  return process.env.NOTIFICATION_EVENT_ADMISSION_ENABLED === "1";
}
async function currentActor(tx: Prisma.TransactionClient, actor: NotificationEventActor) {
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  const rows = await tx.$queryRaw<Array<{ family_id: string | null; role: string; token_version: number }>>`
    SELECT "family_id", "role", "token_version" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
  const row = rows[0];
  return row?.family_id === actor.familyId && row.role === actor.role && row.token_version === actor.tokenVersion;
}
export async function admitNotificationEventInTx(
  tx: Prisma.TransactionClient,
  actor: NotificationEventActor,
  input: unknown,
  sourceGuard: (tx: Prisma.TransactionClient, event: NotificationEventEnvelope) => Promise<boolean>,
  clock: () => Date = () => new Date(),
): Promise<{ kind: "admitted" | "existing"; id: string } | { kind: "held" }> {
  if (!notificationEventAdmissionEnabled()) return { kind: "held" };
  const parsed = notificationEventEnvelope.safeParse(input);
  if (!parsed.success || parsed.data.familyId !== actor.familyId) return { kind: "held" };
  const event = parsed.data;
  if (!await currentActor(tx, actor)) return { kind: "held" };
  if (!notificationDispatchWindowOpen(event, clock()) || !await sourceGuard(tx, event)) return { kind: "held" };
  if (!notificationDispatchWindowOpen(event, clock())) return { kind: "held" };
  const key = createHash("sha256").update(notificationOccurrenceIdentity(event)).digest("hex");
  const inserted = await tx.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "NotificationEventOccurrence" ("family_id", "occurrence_key", "envelope")
    VALUES (${actor.familyId}, ${key}, ${JSON.stringify(event)}::jsonb)
    ON CONFLICT ("family_id", "occurrence_key") DO NOTHING RETURNING "id"`;
  const stored = await tx.$queryRaw<Array<{ id: string; envelope: unknown }>>`
    SELECT "id", "envelope" FROM "NotificationEventOccurrence"
    WHERE "family_id" = ${actor.familyId} AND "occurrence_key" = ${key} FOR UPDATE`;
  // Throw after a possible insert so an unexpected invariant/expiry must abort
  // the enclosing canonical transaction; never leave a partial held admission.
  if (stored.length !== 1 || compareNotificationOccurrence(event, stored[0].envelope) !== "same"
      || !notificationDispatchWindowOpen(event, clock()))
    throw new Error("Notification event admission held");
  return { kind: inserted.length ? "admitted" : "existing", id: stored[0].id };
}

/** Full parent portability, intentionally not a paged UI or feature-toggle read.
 * Retained evidence must still export if admission is switched off on rollback.
 * No personal/teen/shared export of cross-member event/source metadata.
 */
export async function exportNotificationEvents(
  db: Pick<PrismaClient, "$transaction">,
  actor: NotificationEventActor,
) {
  return db.$transaction(async tx => {
    if (actor.role !== "parent" || !await currentActor(tx, actor)) return [];
    return tx.notificationEventOccurrence.findMany({
      where: { family_id: actor.familyId },
      select: { id: true, envelope: true, created_at: true },
      orderBy: { id: "asc" },
    });
  }, { timeout: 5000, maxWait: 5000 });
}
