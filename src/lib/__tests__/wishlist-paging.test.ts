/** Authored source for deferred acceptance; no execution claimed. */
import { parseWishlistPaging, encodeWishlistCursor, afterWishlistCursor } from "../wishlist-paging";
const scope = { familyId: "fixture-family-a", requesterId: "fixture-user-a" };
const row = { id: "fixture-wish-b", created_at: new Date("2026-10-24T12:00:00Z") };
const cursor = encodeWishlistCursor(scope, row);
it("retains the legacy no-parameter path and round trips an opted-in position", () => {
  expect(parseWishlistPaging(new URLSearchParams(), scope)).toEqual({ ok: true, paged: false });
  const parsed = parseWishlistPaging(new URLSearchParams({ limit: "24", mine: "true", cursor }), scope);
  expect(parsed).toEqual({ ok: true, paged: true, limit: 24, cursor: { createdAt: row.created_at, id: row.id } });
  if (parsed.ok && parsed.paged && parsed.cursor) expect(afterWishlistCursor(parsed.cursor)).toEqual({ OR: [
    { created_at: { lt: row.created_at } },
    { created_at: row.created_at, id: { gt: row.id } },
  ] });
});
it("refuses foreign household and different requester/filter positions", () => {
  const params = new URLSearchParams({ limit: "24", cursor });
  expect(parseWishlistPaging(params, { ...scope, familyId: "fixture-family-b" }).ok).toBe(false);
  expect(parseWishlistPaging(params, { ...scope, requesterId: null }).ok).toBe(false);
  expect(parseWishlistPaging(params, { ...scope, requesterId: "fixture-user-b" }).ok).toBe(false);
});
it.each([
  "limit=0", "limit=101", "limit=-1", "limit=1.5", "limit=24&limit=25",
  "cursor=x", "mine=true", "limit=24&mine=x", "limit=24&mine=true&mine=false",
  "limit=24&cursor=a&cursor=b", "limit=24&cursor=bad",
])("refuses malformed or ambiguous inputs: %s", query => {
  expect(parseWishlistPaging(new URLSearchParams(query), scope).ok).toBe(false);
});
