import type { AssistantProofActor } from "@/lib/assistant-source-proof";
import { reviewQueueTargets } from "@/lib/queue-review-server";
import type { QueueReviewEntry } from "@/lib/queue-review-contract";
import { getD1Database, type D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import type { NativeD1 } from "./read-client";
import { authorizeD1Lists } from "./list-authority";

/** Renew household authority alongside the exact, content-minimal projection.
 * The canonical loader only uses these model reads; the D1 facade refuses
 * writes/transactions. The HTTP contract bounds the projection to 50 entries.
 */
export async function reviewD1PersonQueue(
  actor: AssistantProofActor,
  entries: QueueReviewEntry[],
  database?: D1Store,
) {
  const store = database ?? (await getD1Database());
  const captured = await captureD1Reads(
    async (db) => {
      const denied = await authorizeD1Lists(db, actor);
      if (denied) return { denied, rows: undefined };
      const rows = await reviewQueueTargets(
        db as unknown as Parameters<typeof reviewQueueTargets>[0],
        actor.familyId,
        "person",
        entries,
      );
      return { denied: null, rows };
    },
    store as unknown as NativeD1,
  );
  const session = store.withSession("first-primary");
  await session.batch(captured.checks(session));
  return captured.value.denied ?? { status: 200, body: captured.value.rows };
}
