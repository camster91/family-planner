/** Authored/unrun. Signed intent, ownership, opt-in and one-decision semantics. */
jest.mock("../../auth", () => ({
  getJwtSecret: () => "synthetic-feedback-key",
}));
jest.mock("../../beta-metrics", () => ({
  recordBetaMetricInTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../ai-usage-gates", () => ({ isAiUsageReady: () => true }));
import type { PrismaClient } from "@prisma/client";
import {
  issueFoodAiFeedback,
  readFoodAiFeedback,
  recordFoodAiFeedback,
} from "../ai-feedback";
import { recordBetaMetricInTransaction } from "../../beta-metrics";
import { foodAiFeedbackInput } from "../ai-contract";
import { actor, now } from "./recovery-fixture";
function setup(enabled = true) {
  let receipt: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ beta_metrics_enabled: enabled }]),
    user: {
      findUnique: jest.fn().mockResolvedValue({
        family_id: actor.familyId,
        role: actor.role,
        token_version: actor.generation,
      }),
    },
    idempotencyRecord: {
      findFirst: jest.fn(async () => receipt),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        receipt = data;
        return data;
      }),
    },
  };
  const db = {
    $transaction: jest.fn(async (run: (value: unknown) => Promise<unknown>) =>
      run(tx),
    ),
  } as unknown as Pick<PrismaClient, "$transaction">;
  return { tx, db };
}
beforeEach(() => jest.useFakeTimers().setSystemTime(now));
afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});
it("binds opaque tickets to person, household, role, generation and original feedback lease", () => {
  const ticket = issueFoodAiFeedback(actor);
  expect(ticket).not.toContain(actor.userId);
  expect(ticket).not.toContain(actor.familyId);
  expect(readFoodAiFeedback(ticket, actor).issued).toBe(+now);
  for (const changed of [
    { ...actor, familyId: "foreign" },
    { ...actor, userId: "other" },
    { ...actor, role: "teen" },
    { ...actor, generation: 1 },
  ])
    expect(() => readFoodAiFeedback(ticket, changed)).toThrow();
  expect(() => readFoodAiFeedback(ticket, actor, +now + 600000)).toThrow();
  expect(() => readFoodAiFeedback(ticket, actor, +now - 1)).toThrow();
  expect(
    foodAiFeedbackInput.safeParse({
      ticket,
      decision: "used",
      preference: "Do not collect this",
    }).success,
  ).toBe(false);
});
it("counts one fixed decision atomically and does not recount retries or later contradictory decisions", async () => {
  const { db, tx } = setup(),
    ticket = issueFoodAiFeedback(actor);
  await expect(
    recordFoodAiFeedback(db, actor, { ticket, decision: "used" }),
  ).resolves.toMatchObject({ state: "recorded" });
  await recordFoodAiFeedback(db, actor, { ticket, decision: "used" });
  await expect(
    recordFoodAiFeedback(db, actor, { ticket, decision: "kept" }),
  ).rejects.toThrow();
  expect(recordBetaMetricInTransaction).toHaveBeenCalledTimes(1);
  expect(recordBetaMetricInTransaction).toHaveBeenCalledWith(
    tx,
    actor.familyId,
    "food_ai_choices_used",
  );
  expect(tx.idempotencyRecord.create).toHaveBeenCalledTimes(1);
  const data = tx.idempotencyRecord.create.mock.calls[0][0].data;
  expect(data).not.toHaveProperty("ticket");
  expect(data).not.toHaveProperty("decision");
  expect(data.response_body).toEqual({
    protocol: "herewoven.food-ai-feedback.v1",
    state: "recorded",
  });
});
it("creates neither counts nor receipts when the household opted out", async () => {
  const { db, tx } = setup(false);
  await expect(
    recordFoodAiFeedback(db, actor, {
      ticket: issueFoodAiFeedback(actor),
      decision: "kept",
    }),
  ).resolves.toMatchObject({ state: "skipped" });
  expect(recordBetaMetricInTransaction).not.toHaveBeenCalled();
  expect(tx.idempotencyRecord.create).not.toHaveBeenCalled();
});
it("refuses membership/role changes before reading receipts or recording counts", async () => {
  const { db, tx } = setup();
  tx.user.findUnique.mockResolvedValue({
    family_id: "foreign",
    role: actor.role,
    token_version: 0,
  });
  await expect(
    recordFoodAiFeedback(db, actor, {
      ticket: issueFoodAiFeedback(actor),
      decision: "used",
    }),
  ).rejects.toThrow();
  expect(tx.idempotencyRecord.findFirst).not.toHaveBeenCalled();
  expect(recordBetaMetricInTransaction).not.toHaveBeenCalled();
});
