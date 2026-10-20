/** Authored source; no runtime or database acceptance is claimed. */
import type { Prisma } from "@prisma/client";
import {
  accountErasureImportHouseholds,
  erasePersonalImportProvenanceInTx,
} from "../account-erasure-imports";

function fixture() {
  const model = (family_id: string, id: string) => ({
    findMany: jest.fn().mockResolvedValue([{ family_id, id }]),
  });
  const tx = {
    chore: model("z", "own-chore"),
    choreAssignment: model("a", "assignment"),
    habitLog: model("b", "log"),
    earnedBadge: model("a", "badge"),
    rewardRedemption: model("z", "redemption"),
    wishlistItem: model("b", "wish"),
    importedRecord: { deleteMany: jest.fn() },
  };
  return { tx, client: tx as unknown as Prisma.TransactionClient };
}
it("discovers sorted historical personal-target scopes before stable household locks", async () => {
  const { tx, client } = fixture();
  expect(await accountErasureImportHouseholds(client, "departing")).toEqual([
    "a",
    "b",
    "z",
  ]);
  expect(tx.choreAssignment.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        OR: [{ assigned_to: "departing" }, { chore_id: { in: ["own-chore"] } }],
      },
    }),
  );
});
it("removes exact model/id pairs under each target household, never bare target IDs", async () => {
  const { tx, client } = fixture();
  await erasePersonalImportProvenanceInTx(client, "departing", ["a", "b", "z"]);
  expect(
    tx.importedRecord.deleteMany.mock.calls.map(([query]) => query.where),
  ).toEqual([
    {
      family_id: "a",
      OR: [
        { target_model: "ChoreAssignment", target_id: "assignment" },
        { target_model: "EarnedBadge", target_id: "badge" },
      ],
    },
    {
      family_id: "b",
      OR: [
        { target_model: "HabitLog", target_id: "log" },
        { target_model: "WishlistItem", target_id: "wish" },
      ],
    },
    {
      family_id: "z",
      OR: [
        { target_model: "Chore", target_id: "own-chore" },
        { target_model: "RewardRedemption", target_id: "redemption" },
      ],
    },
  ]);
});
it("issues no unbounded delete when no personal targets remain", async () => {
  const { tx, client } = fixture();
  for (const model of [
    tx.chore,
    tx.choreAssignment,
    tx.habitLog,
    tx.earnedBadge,
    tx.rewardRedemption,
    tx.wishlistItem,
  ])
    model.findMany.mockResolvedValue([]);
  await erasePersonalImportProvenanceInTx(client, "departing", ["a", "b", "z"]);
  expect(tx.importedRecord.deleteMany).not.toHaveBeenCalled();
});

it("refuses a newly discovered scope before deleting any provenance", async () => {
  const { tx, client } = fixture();
  await expect(
    erasePersonalImportProvenanceInTx(client, "departing", ["a", "b"]),
  ).rejects.toThrow("changed household scope");
  expect(tx.importedRecord.deleteMany).not.toHaveBeenCalled();
});
it("bounds long-history cleanup predicates without dropping target identities", async () => {
  const { tx, client } = fixture();
  for (const model of [
    tx.choreAssignment,
    tx.habitLog,
    tx.earnedBadge,
    tx.rewardRedemption,
    tx.wishlistItem,
  ])
    model.findMany.mockResolvedValue([]);
  const rows = Array.from({ length: 401 }, (_, i) => ({
    family_id: "z",
    id: `chore-${i}`,
  }));
  tx.chore.findMany.mockResolvedValue(rows);
  await erasePersonalImportProvenanceInTx(client, "departing", ["z"]);
  const predicates = tx.importedRecord.deleteMany.mock.calls.map(
    ([query]) => query.where,
  );
  expect(predicates.map((query) => query.OR.length)).toEqual([200, 200, 1]);
  expect(predicates.every((query) => query.family_id === "z")).toBe(true);
  expect(predicates.flatMap((query) => query.OR)).toEqual(
    rows.map((row) => ({ target_model: "Chore", target_id: row.id })),
  );
});
