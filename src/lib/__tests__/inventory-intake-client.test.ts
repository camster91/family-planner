import {
  makeInventoryIntakeIntent,
  postInventoryIntake,
} from "../inventory-intake-client";
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it("keeps reviewed body/key independent of later edits and reports uncertainty without generating another key", async () => {
  const item = {
    name: "Original beans",
    amount: 2,
    unit: "cans",
    location: "pantry" as const,
  };
  const intent = makeInventoryIntakeIntent(item, {
    userId: "fixture_parent",
    familyId: "fixture_family",
  });
  item.name = "Changed after send";
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ itemId: "fixture_item" }),
    }) as typeof fetch;
  expect(await postInventoryIntake(intent)).toEqual({ kind: "unknown" });
  expect(await postInventoryIntake(intent)).toEqual({
    kind: "confirmed",
    itemId: "fixture_item",
  });
  const calls = (global.fetch as jest.Mock).mock.calls;
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(calls[0][1].headers["Idempotency-Key"]).toBe(
    calls[1][1].headers["Idempotency-Key"],
  );
  expect(JSON.parse(calls[0][1].body)).toMatchObject({
    item: { name: "Original beans" },
    expected_user_id: "fixture_parent",
    expected_family_id: "fixture_family",
  });
});
it("does not treat malformed success or an old server reply as confirmed stock", async () => {
  const intent = makeInventoryIntakeIntent(
    { name: "Beans" },
    { userId: "fixture_parent", familyId: "fixture_family" },
  );
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  })) as typeof fetch;
  expect(await postInventoryIntake(intent)).toEqual({ kind: "unknown" });
});

it("captures an immutable reviewed label without needing or inventing a barcode", () => {
  const label = { package_size: "500 g" };
  const intent = makeInventoryIntakeIntent(
    { name: "Fixture beans", amount: 2, unit: "packages", location: "pantry" },
    { userId: "fixture-parent", familyId: "fixture-family" },
    "fixture-label-key",
    undefined,
    label,
  );
  label.package_size = "later edit";
  expect(JSON.parse(intent.body)).toMatchObject({
    label: { package_size: "500 g" },
    item: { amount: 2, unit: "packages" },
  });
  expect(JSON.parse(intent.body)).not.toHaveProperty("product");
});
