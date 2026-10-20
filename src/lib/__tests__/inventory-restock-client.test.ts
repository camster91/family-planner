import {
  makeRestockIntent,
  postInventoryRestock,
  readRestockReview,
} from "../inventory-restock-client";
import {
  INVENTORY_READ_SCOPE_HEADER,
  inventoryReadScopeValue,
} from "../inventory-read-scope";
const scope = { userId: "fixture-parent", familyId: "fixture-family" };
const intent = makeRestockIntent(
  {
    item_id: "fixture-stock",
    expected_version: "2026-10-20T12:00:00.000Z",
    list_id: "fixture-list",
    content: "Private replacement food",
    amount: 3,
    unit: "cans",
    allow_similar: false,
  },
  scope,
  "original_fixture_key_001",
);
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});
it("keeps original body/key and checks the confirmed target list", async () => {
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          itemId: "fixture-row",
          listId: "fixture-list",
          requestId: "fixture-receipt",
          created: true,
          undoExpiresAt: "2026-10-20T12:10:00.000Z",
        }),
        { status: 201 },
      ),
  );
  expect(await postInventoryRestock(intent)).toMatchObject({
    kind: "confirmed",
  });
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/inventory/restock",
    expect.objectContaining({
      body: intent.body,
      headers: expect.objectContaining({ "Idempotency-Key": intent.key }),
    }),
  );
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          itemId: "fixture-row",
          listId: "other-list",
          requestId: "fixture-receipt",
          created: true,
          undoExpiresAt: "2026-10-20T12:10:00.000Z",
        }),
        { status: 201 },
      ),
  );
  expect(await postInventoryRestock(intent)).toEqual({ kind: "unknown" });
});
it("does not put a private replacement name into a URL and checks read scope before private JSON", async () => {
  const json = jest.fn(async () => ({}));
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({
          [INVENTORY_READ_SCOPE_HEADER]: inventoryReadScopeValue({
            ...scope,
            familyId: "other-family",
          }),
        }),
        json,
      }) as Response,
  );
  await expect(
    readRestockReview(
      scope,
      "fixture-stock",
      "fixture-list",
      "Private replacement food",
    ),
  ).rejects.toThrow();
  expect(json).not.toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/inventory/restock/review",
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Private replacement food"),
    }),
  );
});
it("retains unknown bridge outcomes and never recreates a removed original", async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn(() => new Promise<Response>(() => undefined));
  const pending = postInventoryRestock(intent);
  jest.advanceTimersByTime(15001);
  expect(await pending).toEqual({ kind: "unknown" });
  global.fetch = jest.fn(
    async () =>
      new Response(
        JSON.stringify({ error: { code: "RESTOCK_ORIGINAL_REMOVED" } }),
        { status: 409 },
      ),
  );
  expect(await postInventoryRestock(intent)).toEqual({ kind: "removed" });
});
