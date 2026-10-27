/** Authored for deferred QA, not executed during implementation. */
import { encodeNotificationCursor, parseNotificationPaging, afterNotificationCursor } from "../notification-paging";
const scope = { userId: "fixture-a", unreadOnly: false, includeSnoozed: true };
const row = { id: "fixture-n", created_at: new Date("2026-10-24T12:00:00Z") };
const cursor = encodeNotificationCursor(scope, row);
it("binds continuation to the current personal user and both filters", () => {
  const query = new URLSearchParams({ limit: "50", cursor, includeSnoozed: "true" });
  expect(parseNotificationPaging(query, scope)).toEqual({ ok: true, paged: true, limit: 50, cursor: { id: row.id, createdAt: row.created_at } });
  for (const changed of [{ ...scope, userId: "fixture-b" }, { ...scope, unreadOnly: true }, { ...scope, includeSnoozed: false }])
    expect(parseNotificationPaging(query, changed).ok).toBe(false);
  expect(afterNotificationCursor({ id: row.id, createdAt: row.created_at })).toEqual({ OR: [
    { created_at: { lt: row.created_at } }, { created_at: row.created_at, id: { gt: row.id } },
  ] });
});
it.each(["cursor=bad", "limit=0", "limit=101", "limit=1.5", "limit=50&limit=10", "limit=50&cursor=bad", "limit=50&unread=yes", "limit=50&includeSnoozed=true&includeSnoozed=false"])("refuses malformed or ambiguous paging: %s", query => {
  expect(parseNotificationPaging(new URLSearchParams(query), scope).ok).toBe(false);
});
it("preserves legacy no-parameter behavior", () => {
  expect(parseNotificationPaging(new URLSearchParams(), scope)).toEqual({ ok: true, paged: false });
});
