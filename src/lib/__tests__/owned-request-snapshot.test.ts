/** Authored/unrun read-only discovery cases. No browser/DB isolation proof. */
import { z } from "zod";
import { readOwnedRequestSnapshot } from "../owned-request-snapshot";
import {
  queueOwnerSchema,
  RETIRED_QUEUE_ENVELOPE,
} from "../queue-owner-contract";
const owner = {
  kind: "person" as const,
  ownerId: "person-a",
  scope: "a".repeat(64),
  householdScope: "b".repeat(64),
  generation: 2,
};
const context = {
  enabled: true,
  userId: "person-a",
  familyId: "family-a",
  owner,
};
const schema = z
  .object({
    enabled: z.boolean(),
    userId: z.string(),
    familyId: z.string(),
    owner: queueOwnerSchema.nullable(),
  })
  .strict();
const entry = z
  .object({ kind: z.literal("draft"), key: z.string(), body: z.string() })
  .strict();
const journal = z
  .object({ contract: z.literal("fixture"), entries: z.array(entry).max(2) })
  .strict();
const text = JSON.stringify({
  v: 2,
  envelope: "herewoven.queue-store.v2",
  state: "active",
  owner,
  runtime: "snapshot_fixture_runtime",
  queue: JSON.stringify({
    contract: "fixture",
    entries: [
      { kind: "draft", key: "private-key", body: "private normalized write" },
    ],
  }),
});
function fixture(values: Array<string | null> = [text, null]) {
  const stores = values.map((value) => ({
    read: jest.fn(async () => value),
    write: jest.fn(),
    remove: jest.fn(),
  }));
  const resolveContext = jest.fn(async () => context);
  const project = jest.fn(async (rows: Array<z.infer<typeof entry>>) =>
    rows.map((_row: unknown, index: number) => ({
      id: index,
      label: "Saved request",
    })),
  );
  return {
    stores,
    resolveContext,
    project,
    options: {
      context: schema,
      journal,
      maxBytes: 8192,
      matchesContext: () => true,
      resolveContext,
      candidates: () => stores,
      withLease: async <T>(_owner: unknown, run: () => Promise<T>) => run(),
      project,
    },
  };
}
it("projects without writing, removing, reconciling or exposing raw entries", async () => {
  const f = fixture();
  const result = await readOwnedRequestSnapshot(f.options);
  expect(result.projection).toEqual([{ id: 0, label: "Saved request" }]);
  expect(JSON.stringify(result)).not.toContain("private-key");
  for (const store of f.stores) {
    expect(store.write).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  }
  expect(f.resolveContext).toHaveBeenCalledTimes(3);
});
it("permits read-only recovery discovery while writes are paused", async () => {
  const f = fixture();
  f.resolveContext.mockResolvedValue({ ...context, enabled: false });
  expect((await readOwnedRequestSnapshot(f.options)).enabled).toBe(false);
});
it.each([[RETIRED_QUEUE_ENVELOPE], [text, "different"], ["{broken"]])(
  "holds retired/divergent/invalid stores without cleanup",
  async (...values) => {
    const f = fixture(values as string[]);
    await expect(readOwnedRequestSnapshot(f.options)).rejects.toBeDefined();
    expect(f.project).not.toHaveBeenCalled();
    for (const store of f.stores) {
      expect(store.write).not.toHaveBeenCalled();
      expect(store.remove).not.toHaveBeenCalled();
    }
  },
);
it("withholds projection on owner change after asynchronous projection", async () => {
  const f = fixture();
  f.resolveContext
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce(context)
    .mockResolvedValueOnce({ ...context, owner: { ...owner, generation: 3 } });
  await expect(readOwnedRequestSnapshot(f.options)).rejects.toMatchObject({
    reason: "OWNER_CHANGED",
  });
});
it("holds a changed/retired fallback store after projection", async () => {
  const f = fixture();
  f.stores[1].read
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(RETIRED_QUEUE_ENVELOPE);
  await expect(readOwnedRequestSnapshot(f.options)).rejects.toMatchObject({
    reason: "DIVERGENT",
  });
});
it("does not call an unreadable store empty or project partial data", async () => {
  const f = fixture();
  f.stores[1].read.mockRejectedValueOnce(new Error("blocked"));
  await expect(readOwnedRequestSnapshot(f.options)).rejects.toMatchObject({
    reason: "UNAVAILABLE",
  });
  expect(f.project).not.toHaveBeenCalled();
});
