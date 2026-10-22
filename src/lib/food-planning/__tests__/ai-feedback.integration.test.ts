/** Authored/unrun. Explicit isolated PostgreSQL opt-in; no DDL/provider dispatch. */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../prisma";
import { assertFixtureTargetAllowed } from "../../fixtures/guard";
import { setBetaMetricsEnabled } from "../../beta-metrics";
import {
  issueFoodAiFeedback,
  recordFoodAiFeedback,
  readFoodAiFeedbackCounts,
} from "../ai-feedback";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("food suggestion feedback exactly-once opt-in aggregates", () => {
  const families: string[] = [],
    users: string[] = [];
  let allowed = false;
  const oldReady = process.env.FAMILY_AI_USAGE_READY,
    oldRollback = process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
  beforeAll(() => {
    assertFixtureTargetAllowed(process.env);
    allowed = true;
    process.env.FAMILY_AI_USAGE_READY = "1";
    process.env.FAMILY_AI_USAGE_ROLLBACK_READY = "1";
  });
  afterAll(async () => {
    if (allowed) {
      assertFixtureTargetAllowed(process.env);
      await prisma!.family.deleteMany({ where: { id: { in: families } } });
      await prisma!.user.deleteMany({ where: { id: { in: users } } });
      await prisma!.$disconnect();
    }
    if (oldReady === undefined) delete process.env.FAMILY_AI_USAGE_READY;
    else process.env.FAMILY_AI_USAGE_READY = oldReady;
    if (oldRollback === undefined)
      delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    else process.env.FAMILY_AI_USAGE_ROLLBACK_READY = oldRollback;
  });
  async function fixture() {
    const familyId = `food-feedback-qa-${randomUUID()}`,
      userId = `food-feedback-qa-${randomUUID()}`;
    families.push(familyId);
    users.push(userId);
    await prisma!.family.create({
      data: {
        id: familyId,
        name: "Synthetic feedback household",
        beta_metrics_enabled: true,
      },
      select: { id: true },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        family_id: familyId,
        role: "parent",
        name: "Synthetic parent",
        email: `${userId}@example.invalid`,
      },
      select: { id: true },
    });
    return { userId, familyId, role: "parent", generation: 0 };
  }
  it("counts concurrent copies once, rejects a foreign actor, and opt-out deletes counts without resurrecting them on retry", async () => {
    const actor = await fixture(),
      foreign = await fixture(),
      ticket = issueFoodAiFeedback(actor);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        recordFoodAiFeedback(prisma!, actor, { ticket, decision: "used" }),
      ),
    );
    const counts = () =>
      prisma!.$transaction((tx) =>
        readFoodAiFeedbackCounts(tx, actor.familyId),
      );
    expect(await counts()).toEqual({ used: "1", kept: "0" });
    await expect(
      recordFoodAiFeedback(prisma!, foreign, { ticket, decision: "kept" }),
    ).rejects.toThrow();
    await prisma!.$transaction((tx) =>
      setBetaMetricsEnabled(tx, actor.familyId, false),
    );
    expect(await counts()).toEqual({ used: "0", kept: "0" });
    await prisma!.$transaction((tx) =>
      setBetaMetricsEnabled(tx, actor.familyId, true),
    );
    await expect(
      recordFoodAiFeedback(prisma!, actor, { ticket, decision: "kept" }),
    ).rejects.toThrow();
    expect(await counts()).toEqual({ used: "0", kept: "0" });
  });
  it("rolls the aggregate back if its deduplication receipt cannot commit", async () => {
    const actor = await fixture(),
      ticket = issueFoodAiFeedback(actor);
    const failing = {
      $transaction: (
        work: (tx: unknown) => Promise<unknown>,
        options: unknown,
      ) =>
        prisma!.$transaction(
          async (tx) => {
            const wrapped = new Proxy(tx, {
              get(target, key) {
                if (key === "idempotencyRecord")
                  return new Proxy(target.idempotencyRecord, {
                    get(delegate, method) {
                      if (method === "create")
                        return async () => {
                          throw new Error("synthetic receipt fault");
                        };
                      const value = Reflect.get(delegate, method);
                      return typeof value === "function"
                        ? value.bind(delegate)
                        : value;
                    },
                  });
                const member = Reflect.get(target, key);
                return typeof member === "function"
                  ? member.bind(target)
                  : member;
              },
            });
            return work(wrapped);
          },
          options as { timeout: number },
        ),
    } as unknown as Pick<PrismaClient, "$transaction">;
    await expect(
      recordFoodAiFeedback(failing, actor, { ticket, decision: "used" }),
    ).rejects.toThrow("synthetic receipt fault");
    expect(
      await prisma!.$transaction((tx) =>
        readFoodAiFeedbackCounts(tx, actor.familyId),
      ),
    ).toEqual({ used: "0", kept: "0" });
    await recordFoodAiFeedback(prisma!, actor, { ticket, decision: "used" });
    expect(
      await prisma!.$transaction((tx) =>
        readFoodAiFeedbackCounts(tx, actor.familyId),
      ),
    ).toEqual({ used: "1", kept: "0" });
  });
});
