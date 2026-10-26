import type { Prisma, PrismaClient } from "@prisma/client";
import { readVisibleChoreRows, type ChoreVisibilityCursor } from "@/lib/chore-visible-read";
import { CHORE_UNPAGED_MAX } from "@/lib/chore-paging";
import { hiddenRoutineOccurrenceIds } from "@/lib/routine-occurrence-policy";
import { ANALYTICS_WINDOW_DAYS, MAX_ANALYTICS_CHORES } from "@/lib/analytics-summary-contract";

const select = { id: true, assigned_to: true, status: true, points: true,
  difficulty: true, completed_at: true, due_date: true } as const;
const done = ["completed", "verified"];
/** Preserve analytics' established due-descending, ID-ascending tie order. */
function afterAnalyticsCursor(after: ChoreVisibilityCursor) {
  return { OR: [{ due_date: { lt: after.dueDate } },
    { due_date: after.dueDate, id: { gt: after.id } }] };
}

/** Reuse the ordinary chore visibility policy before the analytics visible cap.
 * Each inner candidate/metadata batch is bounded by the shared reader; outer
 * chunks retain its existing500-row API-independent guard. A dense all-hidden
 * window can require many queries: bounded payload is not a latency guarantee.
 * Completed/verified history bypasses open-occurrence hiding in the policy.
 */
export async function readAnalyticsChores(
  db: Pick<PrismaClient, "chore" | "$queryRaw">,
  familyId: string,
  from: Date,
  through: Date,
  limit: number,
) {
  if (!familyId || !Number.isFinite(from.getTime()) || !Number.isFinite(through.getTime()) ||
    through.getTime() <= from.getTime() || through.getTime() - from.getTime() > ANALYTICS_WINDOW_DAYS * 86400000 ||
    !Number.isInteger(limit) || limit < 1 || limit > MAX_ANALYTICS_CHORES + 1)
    throw new Error("Invalid analytics chore scope");
  const scope = { family_id: familyId, OR: [
    { due_date: { gte: from, lte: through } },
    { status: { in: done }, completed_at: { gte: from, lte: through } },
  ] };
  type Row = Prisma.ChoreGetPayload<{ select: typeof select }>;
  const rows: Row[] = [];
  const seen = new Set<string>();
  let after: ChoreVisibilityCursor | null = null;
  while (rows.length < limit) {
    const take = Math.min(CHORE_UNPAGED_MAX, limit - rows.length);
    const startAfter: ChoreVisibilityCursor | null = after;
    const page: Row[] = await readVisibleChoreRows<Row>({
      take, order: "desc",
      read: (candidate, batchSize) => {
        const cursor = candidate ?? startAfter;
        return db.chore.findMany({
          where: cursor ? { AND: [scope, afterAnalyticsCursor(cursor)] } : scope,
          select, orderBy: [{ due_date: "desc" }, { id: "asc" }], take: batchSize,
        });
      },
      hidden: ids => hiddenRoutineOccurrenceIds(db, familyId, { ids }),
    });
    for (const row of page) {
      if (seen.has(row.id)) throw new Error("Analytics chore cursor repeated a row");
      seen.add(row.id);
      rows.push(row);
    }
    if (page.length < take) break;
    const last = page[page.length - 1];
    after = { id: last.id, dueDate: last.due_date };
  }
  return rows;
}
