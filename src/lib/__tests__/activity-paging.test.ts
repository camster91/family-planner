/** Source cases only; execution remains deferred. */
import { encodeActivityCursor, parseActivityPaging, afterActivityCursor } from "../activity-paging";
const row = { id: "activity-a", created_at: new Date("2026-10-25T12:00:00.000Z") };
it("round-trips the household and exact stable tie position", () => {
  const cursor = encodeActivityCursor("family-a", row);
  const parsed = parseActivityPaging(new URLSearchParams({ paging: "keyset-v1", limit: "2", cursor }), "family-a");
  expect(parsed).toEqual({ ok: true, limit: 2, cursor: { createdAt: row.created_at, id: row.id } });
  if (parsed.ok && parsed.cursor) expect(afterActivityCursor(parsed.cursor)).toEqual({ OR: [
    { created_at: { lt: row.created_at } }, { created_at: row.created_at, id: { gt: row.id } },
  ] });
  expect(parseActivityPaging(new URLSearchParams({ paging: "keyset-v1", cursor }), "family-b").ok).toBe(false);
});
it.each(["paging=other", "paging=keyset-v1&paging=keyset-v1", "paging=keyset-v1&limit=0",
  "paging=keyset-v1&limit=101", "paging=keyset-v1&limit=2&limit=3", "paging=keyset-v1&cursor=",
  "paging=keyset-v1&cursor=2026-10-25T12:00:00Z", "paging=keyset-v1&cursor=%%%",
])("refuses malformed/duplicate/unsupported opt-in parameters (%s)", query => {
  expect(parseActivityPaging(new URLSearchParams(query), "family-a").ok).toBe(false);
});
it("refuses noncanonical base64 and date representations", () => {
  const cursor = encodeActivityCursor("family-a", row);
  expect(parseActivityPaging(new URLSearchParams({ paging: "keyset-v1", cursor: cursor + "=" }), "family-a").ok).toBe(false);
  const shortened = Buffer.from(JSON.stringify(["herewoven.activity-page.v1", "family-a", "2026-10-25T12:00:00Z", row.id])).toString("base64url");
  expect(parseActivityPaging(new URLSearchParams({ paging: "keyset-v1", cursor: shortened }), "family-a").ok).toBe(false);
});
