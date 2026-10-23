import {
  readInventorySnapshot,
  INVENTORY_REFRESH_MS,
  INVENTORY_READ_BYTES,
} from "../inventory-reader";
import {
  inventoryReadScopeValue,
  checkInventoryReadScope,
  INVENTORY_READ_SCOPE_HEADER,
} from "../inventory-read-scope";
const owner = { userId: "fixture-parent", familyId: "fixture-family" };
const scope = inventoryReadScopeValue(owner);
const item = {
  id: "fixture-item",
  name: "Fixture beans",
  amount: 2,
  unit: "cans",
  location: "pantry",
  expires_on: null,
  expiry: { status: "none", daysLeft: null },
  updated_at: "2026-10-19T12:00:00.000Z",
};
function response(body: unknown, status = 200, echo = scope) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { [INVENTORY_READ_SCOPE_HEADER]: echo },
  });
}
const empty = (url: string) =>
  url.includes("/adjustments?") ? { adjustments: [] } : { items: [] };
const read = (fetchImpl: typeof fetch, controller = new AbortController()) =>
  readInventorySnapshot({
    scope,
    today: "2026-10-19",
    mealsOn: false,
    signal: controller.signal,
    fetchImpl,
  });
afterEach(() => jest.useRealTimers());
it("validates optional read binding and refuses different/future owners", () => {
  expect(checkInventoryReadScope(new Headers(), owner)).toBe("unbound");
  expect(
    checkInventoryReadScope(
      new Headers({ [INVENTORY_READ_SCOPE_HEADER]: scope }),
      owner,
    ),
  ).toBe("matched");
  expect(
    checkInventoryReadScope(
      new Headers({ [INVENTORY_READ_SCOPE_HEADER]: scope }),
      { ...owner, familyId: "other" },
    ),
  ).toBe("changed");
  expect(
    checkInventoryReadScope(
      new Headers({ [INVENTORY_READ_SCOPE_HEADER]: "v2.future" }),
      owner,
    ),
  ).toBe("invalid");
});
it("settles a whole refresh at its deadline even when fetch ignores cancellation", async () => {
  jest.useFakeTimers();
  const fetchImpl = jest.fn(
    () => new Promise<Response>(() => undefined),
  ) as unknown as typeof fetch;
  const promise = read(fetchImpl);
  jest.advanceTimersByTime(INVENTORY_REFRESH_MS + 1);
  const result = await promise;
  expect(result.list.state).toBe("error");
  expect(result.history.state).toBe("error");
  expect(result.accessLost).toBeNull();
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
it("checks the scope echo before parsing any private response body", async () => {
  const json = jest.fn(async () => ({ items: [item] }));
  const fetchImpl = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({
      [INVENTORY_READ_SCOPE_HEADER]: inventoryReadScopeValue({
        ...owner,
        familyId: "other",
      }),
    }),
    json,
  })) as unknown as typeof fetch;
  const result = await read(fetchImpl);
  expect(result.accessLost).toBe("context");
  expect(json).not.toHaveBeenCalled();
});
it("marks unsupported scope echo and authorization loss separately from ordinary network errors", async () => {
  const old = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => ({ items: [] }),
  })) as unknown as typeof fetch;
  expect((await read(old)).accessLost).toBe("unsupported");
  const denied = jest.fn(async () =>
    response({}, 403),
  ) as unknown as typeof fetch;
  expect((await read(denied)).accessLost).toBe("context");
});
it("refuses duplicate pages and nonadvancing cursors without claiming a complete inventory", async () => {
  const duplicate = jest.fn(async (url: RequestInfo | URL) =>
    response(
      String(url).startsWith("/api/inventory?")
        ? {
            items: [item],
            nextOffset: String(url).includes("offset=0") ? 500 : null,
          }
        : empty(String(url)),
    ),
  ) as typeof fetch;
  expect((await read(duplicate)).list.state).toBe("error");
  const loop = jest.fn(async (url: RequestInfo | URL) =>
    response(
      String(url).startsWith("/api/inventory?")
        ? { items: [item], nextOffset: 0 }
        : empty(String(url)),
    ),
  ) as typeof fetch;
  expect((await read(loop)).list.state).toBe("error");
});
it("bounds response bytes and preserves optional-section failure as failure", async () => {
  const fetchImpl = jest.fn(async (url: RequestInfo | URL) => {
    if (String(url).includes("/adjustments?")) return response({}, 503);
    if (String(url).startsWith("/api/inventory?"))
      return new Response("too large", {
        headers: {
          [INVENTORY_READ_SCOPE_HEADER]: scope,
          "Content-Length": String(INVENTORY_READ_BYTES + 1),
        },
      });
    return response(empty(String(url)));
  }) as typeof fetch;
  const result = await read(fetchImpl);
  expect(result.list.state).toBe("error");
  expect(result.history.state).toBe("error");
  expect(result.useSoon.state).toBe("ready");
});
