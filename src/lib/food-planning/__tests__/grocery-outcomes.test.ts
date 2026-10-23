/** Authored/unrun. Mocked source-linkage probes are not PostgreSQL acceptance. */
jest.mock("../persist", () => ({
  authorizeFoodWriteInTx: jest.fn(async () => ({})),
  FoodWriteRefused: class extends Error {
    constructor(public result: unknown) {
      super("Fixture refusal");
    }
  },
}));
jest.mock("../review-proof", () => ({ readFoodReviewSeal: jest.fn() }));
jest.mock("../../grocery-from-recipe", () => ({
  ...jest.requireActual("../../grocery-from-recipe"),
  undoRecipeAdd: jest.fn(),
}));
import type { PrismaClient } from "@prisma/client";
import { defaultFeatures } from "../../features";
import { hashIdempotentRequest } from "../../idempotency";
import {
  ADD_FROM_RECIPE_ACTION,
  UNDO_WINDOW_MS,
  addFromRecipeSchema,
  undoRecipeAdd,
} from "../../grocery-from-recipe";
import { FOOD_APPLY_ACTION } from "../apply-contract";
import { authorizeFoodWriteInTx } from "../persist";
import {
  readFoodGroceryOutcomes,
  undoFoodGroceryAdd,
} from "../grocery-outcomes-server";
import { canonicalGroceryResult } from "../grocery-outcomes-contract";
import {
  actor,
  now,
  makeCommand,
  makeEntry,
  receipt,
} from "./recovery-fixture";
const scope = "b".repeat(64);
function fixture() {
  const command = makeCommand();
  command.groceries = [
    { key: "dinner", listId: "list-a", ingredientIds: ["ingredient-a"] },
  ];
  const saved = receipt();
  saved.groceries = [{ key: "dinner", listId: "list-a", requestId: "child-a" }];
  const result = {
    listId: "list-a",
    listName: "Synthetic groceries",
    requestId: "child-a",
    createdCount: 1,
    alreadyOnListCount: 0,
    possibleDuplicates: [],
    possibleDuplicatesTruncated: false,
    undoExpiresAt: new Date(+now + UNDO_WINDOW_MS).toISOString(),
  };
  const tx = {
    family: {
      findUnique: jest.fn(async () => ({ features: defaultFeatures })),
    },
    idempotencyRecord: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ response_status: 201, response_body: saved })
        .mockResolvedValueOnce({
          response_status: 201,
          response_body: result,
          created_at: now,
        }),
    },
  };
  const db = {
    $transaction: jest.fn(async (run: (value: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  return {
    command,
    saved,
    result,
    tx,
    transaction: db.$transaction,
    db: db as unknown as Pick<PrismaClient, "$transaction">,
    entry: makeEntry(command),
  };
}
beforeEach(() => jest.clearAllMocks());
it("reads scoped original root/child receipts without renewing sources or extending Undo", async () => {
  const { command, saved, result, tx, db, entry } = fixture();
  const outcome = await readFoodGroceryOutcomes(db, actor, entry, scope);
  expect(authorizeFoodWriteInTx).toHaveBeenCalledWith(tx, actor, command);
  expect(tx.idempotencyRecord.findFirst).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      where: {
        scope: `user:${actor.userId}`,
        key: entry.key,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: FOOD_APPLY_ACTION,
        request_hash: hashIdempotentRequest(FOOD_APPLY_ACTION, command),
      },
    }),
  );
  expect(tx.idempotencyRecord.findFirst).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      where: {
        id: "child-a",
        scope: `user:${actor.userId}`,
        user_id: actor.userId,
        family_id: actor.familyId,
        action: ADD_FROM_RECIPE_ACTION,
        request_hash: hashIdempotentRequest(
          ADD_FROM_RECIPE_ACTION,
          addFromRecipeSchema.parse({
            recipeId: "recipe-a",
            mealId: "meal-a",
            servings: 2,
            listId: "list-a",
            ingredientIds: ["ingredient-a"],
          }),
        ),
      },
    }),
  );
  expect(outcome.outcomes).toEqual([{ ...saved.groceries[0], result }]);
  expect(undoRecipeAdd).not.toHaveBeenCalled();
});
it("keeps a committed root distinct from missing, malformed or mismatched child details", async () => {
  for (const changed of [
    null,
    {
      response_status: 201,
      response_body: { private: "not a receipt" },
      created_at: now,
    },
  ]) {
    const { saved, tx, db, entry } = fixture();
    tx.idempotencyRecord.findFirst
      .mockReset()
      .mockResolvedValueOnce({ response_status: 201, response_body: saved })
      .mockResolvedValueOnce(changed);
    const outcome = await readFoodGroceryOutcomes(db, actor, entry, scope);
    expect(outcome.outcomes[0].result).toBeNull();
  }
});
it("refuses missing/foreign roots before following any child pointer", async () => {
  const { tx, db, entry } = fixture();
  tx.idempotencyRecord.findFirst.mockReset().mockResolvedValue(null);
  await expect(
    readFoodGroceryOutcomes(db, actor, entry, scope),
  ).rejects.toThrow();
  expect(tx.idempotencyRecord.findFirst).toHaveBeenCalledTimes(1);
});
it("calls canonical Undo inside the authorized transaction for exactly the linked child", async () => {
  const { tx, db, entry, transaction } = fixture();
  jest
    .mocked(undoRecipeAdd)
    .mockResolvedValueOnce({
      status: 200,
      body: { requestId: "child-a", removedCount: 0, keptCheckedCount: 1 },
    });
  const outcome = await undoFoodGroceryAdd(db, actor, entry, "child-a", scope);
  expect(undoRecipeAdd).toHaveBeenCalledWith(tx, "child-a", {
    id: actor.userId,
    family_id: actor.familyId,
    tokenVersion: actor.generation,
  });
  expect(outcome.result).toEqual({
    kind: "done",
    removedCount: 0,
    keptCheckedCount: 1,
  });
  expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
    isolationLevel: "Serializable",
    timeout: 15000,
  });
});
it("never accepts an arbitrary child target or extends an expired Undo", async () => {
  const { db, entry } = fixture();
  await expect(
    undoFoodGroceryAdd(db, actor, entry, "foreign-child", scope),
  ).rejects.toThrow();
  expect(undoRecipeAdd).not.toHaveBeenCalled();
  const next = fixture();
  jest
    .mocked(undoRecipeAdd)
    .mockResolvedValueOnce({
      status: 409,
      body: {
        error: {
          code: "UNDO_WINDOW_EXPIRED",
          message: "Fixture",
          retryable: false,
        },
      },
    });
  const expired = await undoFoodGroceryAdd(
    next.db,
    actor,
    next.entry,
    "child-a",
    scope,
  );
  expect(expired.result).toEqual({
    kind: "refused",
    code: "UNDO_WINDOW_EXPIRED",
  });
});
it("strictly rejects extra private fields in stored child results", () => {
  const { result } = fixture();
  expect(
    canonicalGroceryResult.safeParse({ ...result, contacts: [] }).success,
  ).toBe(false);
});
