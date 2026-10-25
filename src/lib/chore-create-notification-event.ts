/** N1 canonical birth-event adapter, not yet called by chore create.
 * Call only with the actual freshly created row inside createPersonChore's
 * existing transaction, after its ordered User/household locks. No retroactive
 * adoption, current-assignee reconstruction or legacy sender fallback here.
 */
import type { Prisma } from "@prisma/client";
import { isFeatureEnabled, normalizeFeatures } from "@/lib/features";
import {
  admitNotificationEventInTx, notificationEventAdmissionEnabled,
  type NotificationEventActor,
} from "@/lib/notification-event-admission";
import { NOTIFICATION_EVENT_PROTOCOL } from "@/lib/notification-event-contract";

type CreatedChore = {
  id: string; family_id: string; created_by: string; assigned_to: string | null;
  responsibility_generation: string; created_at: Date;
};
export async function recordChoreCreationNotificationEventInTx(
  tx: Prisma.TransactionClient,
  actor: NotificationEventActor,
  created: CreatedChore,
  // Explicit reviewed original deadline; no inferred TTL or renewed retry time.
  deliverBefore: Date,
  clock: () => Date = () => new Date(),
) {
  if (!notificationEventAdmissionEnabled() || actor.role !== "parent"
      || created.family_id !== actor.familyId || created.created_by !== actor.userId
      || !created.assigned_to || !Number.isFinite(created.created_at.getTime())
      || !Number.isFinite(deliverBefore.getTime()))
    return { kind: "held" as const };
  return admitNotificationEventInTx(tx, actor, {
    protocol: NOTIFICATION_EVENT_PROTOCOL, familyId: actor.familyId,
    kind: "chore.assignment", sourceId: created.id,
    sourceGeneration: created.responsibility_generation,
    // Canonical row birth is exactly one transition per immutable generation.
    // Later assignment/verification transitions need their own accepted identity.
    transitionId: "created", occurredAt: created.created_at.toISOString(),
    deliverBefore: deliverBefore.toISOString(),
  }, async (sourceTx) => {
    const families = await sourceTx.$queryRaw<Array<{ features: Prisma.JsonValue | null }>>`
      SELECT "features" FROM "Family" WHERE "id" = ${actor.familyId} FOR SHARE`;
    if (families.length !== 1 || !isFeatureEnabled(normalizeFeatures(families[0].features), "chores")) return false;
    const rows = await sourceTx.$queryRaw<Array<CreatedChore & { status: string; member_subject_erased: boolean }>>`
      SELECT "id", "family_id", "created_by", "assigned_to", "responsibility_generation", "created_at", "status", "member_subject_erased"
      FROM "Chore" WHERE "id" = ${created.id} AND "family_id" = ${actor.familyId} FOR UPDATE`;
    const row = rows.length === 1 ? rows[0] : null;
    return !!row && row.created_by === actor.userId && row.assigned_to === created.assigned_to
      && row.responsibility_generation === created.responsibility_generation
      && row.created_at.getTime() === created.created_at.getTime()
      && row.status === "pending" && !row.member_subject_erased;
  }, clock);
}
