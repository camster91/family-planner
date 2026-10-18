jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);

import {
  createBudgetTransactionWithReceipt,
  updateBudgetTransactionWithReceipt,
} from "@/lib/budget-transaction-write";
import { db, fakePrisma } from "@/__tests__/helpers/two-household";

const actor = { familyId: "family-A", userId: "parent-a" };
const input = {
  amount: 12.5,
  type: "expense" as const,
  category_id: "cat-a",
  description: "Unit test groceries",
  notes: undefined,
  date: "2026-10-18",
  is_recurring: false,
  recurring_interval: null,
};

describe("Budget transaction mutation helper", () => {
  beforeEach(() => {
    db.reset();
    db.find("family", "family-A")!.features = { budget: true };
  });

  it("commits a keyed row and receipt together, then replays the stored body", async () => {
    const receipt = await fakePrisma.idempotencyRecord.create({
      data: {
        scope: "user:parent-a",
        key: "budget-unit-create",
        family_id: "family-A",
        user_id: "parent-a",
        action: "budget.transaction.create",
        request_hash: "hash",
      },
    });

    const first = await createBudgetTransactionWithReceipt(
      fakePrisma,
      input,
      actor,
      receipt.id,
    );
    expect(first.status).toBe(201);
    expect(db.rows("transaction")).toHaveLength(3);
    expect(db.find("idempotencyRecord", receipt.id)?.response_status).toBe(201);

    const replay = await createBudgetTransactionWithReceipt(
      fakePrisma,
      input,
      actor,
      receipt.id,
    );
    expect(replay).toEqual({
      status: 201,
      body: db.find("idempotencyRecord", receipt.id)?.response_body,
    });
    expect(db.rows("transaction")).toHaveLength(3);
  });

  it("rejects a foreign category before writing, and rechecks role and feature", async () => {
    const foreign = await createBudgetTransactionWithReceipt(
      fakePrisma,
      { ...input, category_id: "cat-b" },
      actor,
      null,
    );
    expect(foreign).toMatchObject({
      status: 403,
      body: { error: "Forbidden" },
    });
    expect(db.rows("transaction")).toHaveLength(2);

    db.find("user", "parent-a")!.role = "teen";
    const roleDenied = await updateBudgetTransactionWithReceipt(
      fakePrisma,
      "txn-a",
      { transactionId: "txn-a", amount: 13 },
      actor,
      null,
    );
    expect(roleDenied).toMatchObject({
      status: 403,
      body: { error: "Only parents can perform this action" },
    });
    expect(db.find("transaction", "txn-a")?.amount).toBe(42);

    db.find("user", "parent-a")!.role = "parent";
    db.find("family", "family-A")!.features = { budget: false };
    const featureDenied = await updateBudgetTransactionWithReceipt(
      fakePrisma,
      "txn-a",
      { transactionId: "txn-a", amount: 13 },
      actor,
      null,
    );
    expect(featureDenied).toMatchObject({
      status: 403,
      body: { error: "This feature is turned off for your family" },
    });
    expect(db.find("transaction", "txn-a")?.amount).toBe(42);
  });
});
