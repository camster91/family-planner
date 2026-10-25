/** Authored/unrun: additive scope-bound notes positions. */
import { parseNotePaging, encodeNoteCursor, afterNoteCursor } from "../note-paging";
const row = { id: "fixture-note-a", created_at: new Date("2026-10-24T12:00:00Z") };
const cursor = encodeNoteCursor("family-a", row);
it("retains legacy mode and round trips a timestamp/ID boundary", () => {
  expect(parseNotePaging(new URLSearchParams(), "family-a")).toEqual({ ok: true, paged: false });
  expect(parseNotePaging(new URLSearchParams({ limit: "24", cursor }), "family-a")).toEqual({
    ok: true, paged: true, limit: 24, cursor: { createdAt: row.created_at, id: row.id },
  });
  expect(afterNoteCursor({ createdAt: row.created_at, id: row.id })).toEqual({ OR: [
    { created_at: { lt: row.created_at } },
    { created_at: row.created_at, id: { gt: row.id } },
  ] });
});
it("refuses a different household or noncanonical base64 encoding", () => {
  expect(parseNotePaging(new URLSearchParams({ limit: "24", cursor }), "family-b").ok).toBe(false);
  expect(parseNotePaging(new URLSearchParams({ limit: "24", cursor: cursor + "=" }), "family-a").ok).toBe(false);
});
it.each(["limit=0", "limit=101", "limit=1.5", "limit=2&limit=3", "cursor=bad", "limit=2&cursor=x&cursor=y", "limit=2&cursor="])(
  "refuses malformed or ambiguous notes paging: %s", query => {
    expect(parseNotePaging(new URLSearchParams(query), "family-a").ok).toBe(false);
  },
);
