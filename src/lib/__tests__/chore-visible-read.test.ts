/** Authored/unrun. No database or household effects. */
import { readVisibleChoreRows, afterCreatedChoreCursor, CHORE_VISIBILITY_READ_BATCH, type ChoreVisibilityCursor } from "../chore-visible-read";
import { compareChoreOrder, type ChoreCursor, type ChoreOrder } from "../chore-paging";
const rows = (count: number) => Array.from({ length: count }, (_, i) => ({
  id: `synthetic-${String(i).padStart(4, "0")}`,
  due_date: new Date("2026-10-24T00:00:00Z"),
}));
type TestChore = ReturnType<typeof rows>[number];
function reader(source: ReturnType<typeof rows>, order: ChoreOrder, publicCursor: ChoreCursor | null = null) {
  const sorted = [...source].sort((a, b) => compareChoreOrder(a, b) * (order === "asc" ? 1 : -1));
  return jest.fn(async (after: ChoreCursor | null, take: number) => sorted.filter((row) => {
    const passes = (cursor: ChoreCursor | null) => !cursor ||
      (order === "asc" ? 1 : -1) * compareChoreOrder(row, { id: cursor.id, due_date: cursor.dueDate }) > 0;
    return passes(publicCursor) && passes(after);
  }).slice(0, take));
}
it("continues past dense hidden batches instead of letting hidden rows consume the visible cap", async () => {
  const source = rows(260);
  const hiddenIds = new Set(source.slice(0, 245).map((row) => row.id));
  const read = reader(source, "asc");
  const hidden = jest.fn(async (ids: readonly string[]) => ids.filter((id) => hiddenIds.has(id)));
  expect(await readVisibleChoreRows({ take: 3, order: "asc", read, hidden })).toEqual(source.slice(245, 248));
  expect(read.mock.calls.length).toBeGreaterThan(1);
  expect(read.mock.calls.every(([, take]) => take <= CHORE_VISIBILITY_READ_BATCH)).toBe(true);
  expect(hidden.mock.calls.every(([ids]) => ids.length <= CHORE_VISIBILITY_READ_BATCH)).toBe(true);
  expect(hidden.mock.calls.flatMap(([ids]) => ids)).not.toContain(source[259].id);
});
it.each(["asc", "desc"] as const)("preserves public %s pagination across hidden rows and same-date ties", async (order) => {
  const source = rows(45);
  const hiddenIds = new Set(source.filter((_, i) => i % 3 !== 0).map((row) => row.id));
  const seen: string[] = [];
  let cursor: ChoreCursor | null = null;
  for (let page = 0; page < 30; page++) {
    const visible: TestChore[] = await readVisibleChoreRows<TestChore>({
      take: 3, order, read: reader(source, order, cursor),
      hidden: async (ids) => ids.filter((id) => hiddenIds.has(id)),
    });
    const returned: TestChore[] = visible.slice(0, 2);
    seen.push(...returned.map((row) => row.id));
    if (visible.length <= 2) break;
    const last: TestChore = returned[returned.length - 1]!;
    cursor = { id: last.id, dueDate: last.due_date };
  }
  const expected = source.filter((row) => !hiddenIds.has(row.id)).map((row) => row.id);
  expect(seen).toEqual(order === "asc" ? expected : expected.reverse());
  expect(new Set(seen).size).toBe(seen.length);
});
it("fills the legacy newest-visible cap without materializing every hidden ID", async () => {
  const source = rows(620);
  const hiddenIds = new Set(source.slice(500).map((row) => row.id));
  const result = await readVisibleChoreRows({
    take: 500, order: "desc", read: reader(source, "desc"),
    hidden: async (ids) => ids.filter((id) => hiddenIds.has(id)),
  });
  expect(result).toEqual(source.slice(0, 500).reverse());
});
it("returns an empty visible result only after an all-hidden candidate range ends", async () => {
  const read = reader(rows(90), "asc");
  expect(await readVisibleChoreRows({ take: 2, order: "asc", read, hidden: async (ids) => ids })).toEqual([]);
  expect(read.mock.calls.length).toBeGreaterThan(1);
});
it("fails instead of returning a partial page when a later metadata read fails", async () => {
  const source = rows(90);
  let call = 0;
  await expect(readVisibleChoreRows({
    take: 40, order: "asc", read: reader(source, "asc"),
    hidden: async (ids) => {
      if (++call > 1) throw new Error("Synthetic read failure");
      return ids.slice(1);
    },
  })).rejects.toThrow("Synthetic read failure");
});
it("refuses a repeated candidate cursor rather than looping forever", async () => {
  const source = rows(32);
  await expect(readVisibleChoreRows({
    take: 2, order: "asc", read: async () => source,
    hidden: async (ids) => ids,
  })).rejects.toThrow("repeated a row");
});
it("refuses oversized candidate responses and invalid visible caps", async () => {
  await expect(readVisibleChoreRows({
    take: 2, order: "asc", read: async () => rows(CHORE_VISIBILITY_READ_BATCH + 1),
    hidden: async () => [],
  })).rejects.toThrow("exceeded its bound");
  await expect(readVisibleChoreRows({
    take: 502, order: "asc", read: async () => [], hidden: async () => [],
  })).rejects.toThrow("Invalid visible chore read size");
});
it("preserves Today's creation-time ordering across dense hidden rows sharing a due date", async () => {
  const source = rows(80).map((row, i) => ({
    ...row, created_at: new Date(Date.UTC(2026, 9, 20, 0, 0, 80 - i)),
  })).reverse();
  const hiddenIds = new Set(source.slice(0, 50).map((row) => row.id));
  const read = jest.fn(async (after: ChoreVisibilityCursor | null, take: number) =>
    source.filter((row) => !after || row.created_at > after.createdAt! ||
      (row.created_at.getTime() === after.createdAt!.getTime() && row.id > after.id))
      .slice(0, take));
  expect(await readVisibleChoreRows({
    take: 2, order: "asc", tieBreakCreatedAt: true, read,
    hidden: async (ids) => ids.filter((id) => hiddenIds.has(id)),
  })).toEqual(source.slice(50, 52));
  expect(read.mock.calls[1][0]).toEqual({
    id: source[31].id, dueDate: source[31].due_date, createdAt: source[31].created_at,
  });
});
it.each(["asc", "desc"] as const)("uses all three private cursor keys for Today's %s order", (order) => {
  const dueDate = new Date("2026-10-24T00:00:00Z");
  const createdAt = new Date("2026-10-20T12:00:00Z");
  const comparison = order === "asc" ? "gt" : "lt";
  expect(afterCreatedChoreCursor({ id: "synthetic", dueDate, createdAt }, order)).toEqual({ OR: [
    { due_date: { [comparison]: dueDate } },
    { due_date: dueDate, created_at: { [comparison]: createdAt } },
    { due_date: dueDate, created_at: createdAt, id: { [comparison]: "synthetic" } },
  ] });
});
