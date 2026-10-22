/** Authored for consolidated QA; these mocked reads do not prove DB isolation. */
jest.mock("../persist", () => ({
  authorizeFoodWriteInTx: jest.fn(async () => ({})),
}));
jest.mock("../server", () => ({
  foodPlanningEnabled: jest.fn(() => true),
  FoodPlanningUnavailable: class extends Error {},
}));
import type { PrismaClient } from "@prisma/client";
import { authorizeFoodWriteInTx } from "../persist";
import { foodPlanningEnabled } from "../server";
import { readFoodOptions } from "../options-server";
import {
  FOOD_OPTIONS,
  foodOptionsQuery,
  foodOptionsReply,
} from "../options-contract";
const actor = {
  userId: "parent-a",
  familyId: "family-a",
  role: "parent",
  generation: 2,
};
function fixture() {
  const tx = {
    recipe: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    list: { findMany: jest.fn() },
    event: { findMany: jest.fn() },
  };
  const db = {
    $transaction: jest.fn(async (run: (value: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  return { tx, db: db as unknown as Pick<PrismaClient, "$transaction"> };
}
beforeEach(() => {
  jest.mocked(foodPlanningEnabled).mockReturnValue(true);
  jest.mocked(authorizeFoodWriteInTx).mockClear();
});
it("bounds pages, validates exact departure intervals and refuses unknown input", () => {
  expect(
    foodOptionsQuery.safeParse({ kind: "recipes", offset: 1 }).success,
  ).toBe(false);
  expect(
    foodOptionsQuery.safeParse({
      kind: "recipes",
      selectedIds: ["recipe-a", "recipe-a"],
    }).success,
  ).toBe(false);
  expect(
    foodOptionsQuery.safeParse({
      kind: "recipes",
      url: "https://example.invalid",
    }).success,
  ).toBe(false);
  expect(foodOptionsQuery.safeParse({ kind: "departures" }).success).toBe(
    false,
  );
  expect(
    foodOptionsQuery.safeParse({
      kind: "departures",
      range: { start: "2026-10-22T10:00", end: "2026-10-23T10:00" },
    }).success,
  ).toBe(false);
  expect(
    foodOptionsQuery.safeParse({
      kind: "departures",
      range: { start: "2026-10-22T10:00:00Z", end: "2026-12-23T10:00:00Z" },
    }).success,
  ).toBe(false);
});
it("returns eight household results with a next-page signal and no private recipe body", async () => {
  const { tx, db } = fixture();
  tx.recipe.findMany.mockResolvedValue(
    Array.from({ length: 9 }, (_, i) => ({
      id: `recipe-${i}`,
      title: `Synthetic ${i}`,
      servings: 2,
      prep_time: null,
      cook_time: 20,
    })),
  );
  const result = await readFoodOptions(
    db,
    actor,
    foodOptionsQuery.parse({ kind: "recipes", search: " rice ", offset: 8 }),
  );
  expect(authorizeFoodWriteInTx).toHaveBeenCalledWith(tx, actor);
  expect(tx.recipe.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        family_id: "family-a",
        title: { contains: "rice", mode: "insensitive" },
      },
      skip: 8,
      take: 9,
      select: {
        id: true,
        title: true,
        servings: true,
        prep_time: true,
        cook_time: true,
      },
    }),
  );
  expect(result.items).toHaveLength(8);
  expect(result.hasMore).toBe(true);
  expect(result.items[0]).toMatchObject({ minutes: null });
});
it("looks up selected items separately from search and refuses missing or foreign selections equally", async () => {
  const { tx, db } = fixture();
  tx.list.findMany
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([
      { id: "list-a", name: "Synthetic groceries", type: "grocery" },
    ]);
  const query = foodOptionsQuery.parse({
    kind: "lists",
    search: "other",
    selectedIds: ["list-a"],
  });
  const result = await readFoodOptions(db, actor, query);
  expect(result.selected).toHaveLength(1);
  expect(tx.list.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: {
        family_id: "family-a",
        type: { in: ["grocery", "shopping"] },
        id: { in: ["list-a"] },
      },
      take: 50,
    }),
  );
  tx.list.findMany.mockResolvedValue([]);
  await expect(readFoodOptions(db, actor, query)).rejects.toThrow();
});
it("rejects extra contact fields, substituted selections and mixed record kinds", () => {
  const query = foodOptionsQuery.parse({
    kind: "people",
    selectedIds: ["person-a"],
  });
  const person = {
    kind: "person",
    id: "person-a",
    name: "Synthetic account",
    role: "teen",
  };
  const reply = {
    protocol: FOOD_OPTIONS,
    owner: actor,
    query,
    items: [person],
    selected: [person],
    hasMore: false,
  };
  expect(foodOptionsReply.safeParse(reply).success).toBe(true);
  expect(
    foodOptionsReply.safeParse({
      ...reply,
      selected: [{ ...person, email: "fixture@example.invalid" }],
    }).success,
  ).toBe(false);
  expect(
    foodOptionsReply.safeParse({
      ...reply,
      selected: [{ ...person, id: "person-b" }],
    }).success,
  ).toBe(false);
  expect(
    foodOptionsReply.safeParse({
      ...reply,
      items: [
        { kind: "list", id: "list-a", name: "Synthetic list", type: "grocery" },
      ],
    }).success,
  ).toBe(false);
});
it("checks readiness after the read and never returns source metadata after authority refusal", async () => {
  const { tx, db } = fixture();
  tx.user.findMany.mockResolvedValue([]);
  jest
    .mocked(foodPlanningEnabled)
    .mockReturnValueOnce(true)
    .mockReturnValueOnce(false);
  await expect(
    readFoodOptions(db, actor, foodOptionsQuery.parse({ kind: "people" })),
  ).rejects.toThrow();
  jest.mocked(foodPlanningEnabled).mockReturnValue(true);
  jest
    .mocked(authorizeFoodWriteInTx)
    .mockRejectedValueOnce(new Error("Synthetic authority refusal"));
  tx.user.findMany.mockClear();
  await expect(
    readFoodOptions(db, actor, foodOptionsQuery.parse({ kind: "people" })),
  ).rejects.toThrow();
  expect(tx.user.findMany).not.toHaveBeenCalled();
});
