/** Authored/unrun. Cursor scope and exact tie continuation; no database effects. */
import { parseProjectTaskPaging, encodeProjectTaskCursor, afterProjectTaskCursor } from "../project-task-paging";
const scope = { familyId: "family-a", projectId: "project-a", completed: null };
const row = { id: "task-a", position: 2, created_at: new Date("2026-10-24T12:00:00Z") };
it("preserves legacy unpaged requests and requires a limit for a cursor", () => {
  expect(parseProjectTaskPaging(new URLSearchParams(), scope)).toEqual({ ok: true, paged: false });
  expect(parseProjectTaskPaging(new URLSearchParams({ cursor: "bad" }), scope).ok).toBe(false);
});
it("round-trips position, creation time and ID in an exact scoped cursor", () => {
  const cursor = encodeProjectTaskCursor(scope, row);
  expect(parseProjectTaskPaging(new URLSearchParams({ limit: "40", cursor }), scope)).toEqual({
    ok: true, paged: true, limit: 40,
    cursor: { position: 2, createdAt: row.created_at, id: "task-a" },
  });
});
it.each([
  { ...scope, familyId: "other-family" },
  { ...scope, projectId: "other-project" },
  { ...scope, completed: true },
])("refuses a cursor from another household/project/completion filter", (other) => {
  expect(parseProjectTaskPaging(new URLSearchParams({ limit: "40", cursor: encodeProjectTaskCursor(other, row) }), scope).ok).toBe(false);
});
it.each(["limit=0", "limit=101", "limit=1.5", "limit=2&limit=3", "limit=2&cursor=x&cursor=y", "limit=2&completed=maybe"])(
  "rejects malformed or duplicate paging parameters: %s", (query) => {
    expect(parseProjectTaskPaging(new URLSearchParams(query), scope).ok).toBe(false);
  },
);
it("continues within position and timestamp ties instead of skipping an entire group", () => {
  expect(afterProjectTaskCursor({ position: 2, createdAt: row.created_at, id: "task-a" })).toEqual({ OR: [
    { position: { gt: 2 } },
    { position: 2, created_at: { gt: row.created_at } },
    { position: 2, created_at: row.created_at, id: { gt: "task-a" } },
  ] });
});
