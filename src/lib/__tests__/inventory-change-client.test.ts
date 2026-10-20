import {
  makeInventoryChangeIntent,
  postInventoryChange,
} from "../inventory-change-client";
const original = global.fetch;
afterEach(() => {
  global.fetch = original;
});
const operation = {
  kind: "consume" as const,
  item_id: "fixture-item",
  expected_version: "2026-10-19T12:00:00.000Z",
  amount: 0.5,
};
const context = { userId: "fixture-parent", familyId: "fixture-family" };
it("keeps one exact request across lost response and later access refusal", async () => {
  const intent = makeInventoryChangeIntent(operation, context);
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("response lost"))
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: { code: "INTAKE_FORBIDDEN" } }),
    }) as typeof fetch;
  expect(await postInventoryChange(intent)).toEqual({ kind: "unknown" });
  expect(await postInventoryChange(intent)).toEqual({
    kind: "refused",
    code: "INTAKE_FORBIDDEN",
  });
  const calls = (fetch as jest.Mock).mock.calls;
  expect(calls[1][0]).toBe("/api/inventory/change");
  expect(calls[1][1].body).toBe(calls[0][1].body);
  expect(calls[1][1].headers).toEqual(calls[0][1].headers);
});
it.each([
  { itemId: "other-item", adjustmentId: "fixture-adjustment", kind: "consume" },
  {
    itemId: "fixture-item",
    adjustmentId: "fixture-adjustment",
    kind: "discard",
  },
  { success: true },
])(
  "does not accept a malformed or mismatched pointer receipt: %o",
  async (receipt) => {
    global.fetch = jest.fn(
      async () =>
        ({ ok: true, status: 200, json: async () => receipt }) as Response,
    );
    expect(
      await postInventoryChange(makeInventoryChangeIntent(operation, context)),
    ).toEqual({ kind: "unknown" });
  },
);
it("distinguishes confirmed no-effect and original removal without silently starting a new operation", async () => {
  const intent = makeInventoryChangeIntent(operation, context);
  global.fetch = jest
    .fn()
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "CHANGE_CONFLICT" } }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: "CHANGE_ORIGINAL_REMOVED" } }),
    }) as typeof fetch;
  expect(await postInventoryChange(intent)).toEqual({ kind: "not_applied" });
  expect(await postInventoryChange(intent)).toEqual({ kind: "removed" });
});
