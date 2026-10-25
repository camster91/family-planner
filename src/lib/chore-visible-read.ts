/** Bounded candidate/metadata reads; visibility is applied before the visible cap. */
import {
  CHORE_UNPAGED_MAX,
  type ChoreCursor,
  type ChoreOrder,
} from "@/lib/chore-paging";

export const CHORE_VISIBILITY_READ_BATCH = 200;
type Candidate = { id: string; due_date: Date };

/**
 * Caller pins household, status/assignee/date scope and the original public
 * cursor in `read`. Every subsequent read adds the private candidate cursor.
 * Do not cap candidate reads once and then hide rows: continue until enough
 * visible rows exist or the candidate set ends. A page's lookahead is visible too.
 *
 * Memory/query payloads are bounded; total work is NOT a latency bound. An all-
 * hidden dense range may require multiple reads. Errors return no partial result.
 */
export async function readVisibleChoreRows<T extends Candidate>({
  take,
  order,
  read,
  hidden,
}: {
  take: number;
  order: ChoreOrder;
  read: (after: ChoreCursor | null, batchSize: number) => Promise<T[]>;
  hidden: (ids: readonly string[]) => Promise<readonly string[]>;
}): Promise<T[]> {
  if (!Number.isInteger(take) || take < 1 || take > CHORE_UNPAGED_MAX + 1)
    throw new Error("Invalid visible chore read size");
  const batchSize = Math.min(CHORE_VISIBILITY_READ_BATCH, Math.max(take, 32));
  const visible: T[] = [];
  let after: ChoreCursor | null = null;
  while (visible.length < take) {
    const rows = await read(after, batchSize);
    if (rows.length > batchSize)
      throw new Error("Chore candidate read exceeded its bound");
    if (rows.length === 0) break;
    let previous: Candidate | null = after
      ? { id: after.id, due_date: after.dueDate }
      : null;
    const ids = new Set(after ? [after.id] : []);
    for (const row of rows) {
      if (ids.has(row.id)) throw new Error("Chore candidate cursor repeated a row");
      ids.add(row.id);
      if (!Number.isFinite(row.due_date.getTime()))
        throw new Error("Invalid chore candidate date");
      if (previous) {
        // PostgreSQL owns the ID tie order/collation; do not approximate it in JS.
        const direction = row.due_date.getTime() - previous.due_date.getTime();
        if (order === "asc" ? direction < 0 : direction > 0)
          throw new Error("Chore candidate cursor did not advance");
      }
      previous = row;
    }
    const hiddenIds = new Set(await hidden(rows.map((row) => row.id)));
    for (const row of rows) {
      if (!hiddenIds.has(row.id)) visible.push(row);
      if (visible.length === take) return visible;
    }
    if (rows.length < batchSize) break;
    const last = rows[rows.length - 1];
    after = { dueDate: last.due_date, id: last.id };
  }
  return visible;
}
