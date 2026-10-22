/** A content-minimal canonical change fact, inside the effect transaction.
 * No proposal, actor inference, idempotency key, source token or content copy.
 */
import type { Prisma } from "@prisma/client";
import type { TimelineTarget } from "./timeline-contract";
export async function recordTimelineFactInTx(
  tx: Pick<Prisma.TransactionClient, "activity">,
  actor: { userId: string; familyId: string },
  action:
    | "chore_created"
    | "recipe_created"
    | "preparation_changed"
    | "schedule_changed"
    | "responsibility_changed",
  target: Exclude<TimelineTarget, { kind: "settings" }>,
  now = new Date(),
) {
  await tx.activity.create({
    data: {
      family_id: actor.familyId,
      user_id: actor.userId,
      type: action,
      title: "Household record changed",
      created_at: now,
      metadata: JSON.stringify({ timeline: 1, actorKind: "person", target }),
    },
    select: { id: true },
  });
}
