/** Navigation intent only. Canonical bulk reads/actions supply all authority. */
import { z } from "zod";
import { memberIdentityIdSchema as id } from "./member-subject-contract";
import { batchPortionCounts, type MealPrepSummary } from "./meal-batches";
const targetSchema = z.object({ sessionId: id, batchId: id }).strict();
export type PreparedReuseTarget = z.infer<typeof targetSchema>;
export type PreparedReuseIntent =
  | { state: "none" }
  | { state: "invalid" }
  | { state: "target"; target: PreparedReuseTarget };
export function preparedReuseIntent(
  params: Pick<URLSearchParams, "get">,
): PreparedReuseIntent {
  const sessionId = params.get("preparedSession"),
    batchId = params.get("preparedBatch");
  if (sessionId === null && batchId === null) return { state: "none" };
  const parsed = targetSchema.safeParse({ sessionId, batchId });
  if (
    !parsed.success ||
    params.get("view") !== "bulk" ||
    params.get("recipe") !== null
  )
    return { state: "invalid" };
  return { state: "target", target: parsed.data };
}
export function preparedReuseHref(target: PreparedReuseTarget) {
  const parsed = targetSchema.parse(target);
  const query = new URLSearchParams({
    view: "bulk",
    preparedSession: parsed.sessionId,
    preparedBatch: parsed.batchId,
  });
  return `/dashboard/meals?${query}`;
}
/** Explicitly fail closed rather than selecting another session/dish. This is a
 * presentation check; the canonical action recomputes portions under its lock. */
export function resolvePreparedReuse(
  sessions: MealPrepSummary[],
  target: PreparedReuseTarget,
) {
  const session = sessions.find((row) => row.id === target.sessionId);
  const batch = session?.batches.find((row) => row.id === target.batchId);
  if (!session || !batch) return { state: "unavailable" as const };
  if (!session.prepared_at) return { state: "unprepared" as const };
  if (batch.portions_complete !== true)
    return { state: "unavailable" as const };
  const counts = batchPortionCounts(
    batch.total_servings,
    batch.meals,
    batch.consumption,
  );
  if (
    ![counts.eaten, counts.planned, counts.remaining, counts.unplanned].every(
      (value) => Number.isInteger(value) && value >= 0,
    )
  )
    return { state: "unavailable" as const };
  if (counts.unplanned <= 0) return { state: "full" as const };
  return { state: "ready" as const, session, batch, counts };
}
