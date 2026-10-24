/** Authored for deferred QA; not executed during implementation. */
import { afterProjectCursor, encodeProjectCursor, parseProjectPaging } from "../project-paging";
const scope = { familyId: "fixture-family-a", status: "active" };
const row = { id: "fixture-project-b", created_at: new Date("2026-10-24T12:00:00Z") };
const cursor = encodeProjectCursor(scope, row);
it("retains opt-in paging and the legacy no-parameter shape", () => {
  expect(parseProjectPaging(new URLSearchParams(), scope)).toEqual({ ok: true, paged: false });
  const parsed = parseProjectPaging(new URLSearchParams({ limit: "24", cursor }), scope);
  expect(parsed).toEqual({ ok: true, paged: true, limit: 24, cursor: { id: row.id, createdAt: row.created_at } });
  if (parsed.ok && parsed.paged && parsed.cursor) {
    expect(afterProjectCursor(parsed.cursor)).toEqual({ OR: [
      { created_at: { lt: row.created_at } },
      { created_at: row.created_at, id: { gt: row.id } },
    ] });
  }
});
it("rejects a cursor from a different household or status", () => {
  const query = new URLSearchParams({ limit: "24", cursor });
  expect(parseProjectPaging(query, { ...scope, familyId: "fixture-family-b" }).ok).toBe(false);
  expect(parseProjectPaging(query, { ...scope, status: "completed" }).ok).toBe(false);
});
it.each(["limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=24&limit=25", "limit=24&status=active&status=completed", "cursor=bad", "limit=24&cursor=bad", "limit=24&cursor=a&cursor=b"])("refuses malformed or ambiguous paging: %s", query => {
  expect(parseProjectPaging(new URLSearchParams(query), scope).ok).toBe(false);
});
