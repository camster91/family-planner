/** UNRUN. Explicit disposable DB opt-in; no DDL or provider calls here. */
import { randomUUID } from "node:crypto";
import { prisma } from "../prisma";
import { assertFixtureTargetAllowed } from "../fixtures/guard";
import { encryptSecret } from "../secret-box";
import {
  aiUsageStorageAvailable,
  reserveAiUsage,
  saveAiUsagePolicy,
  aiConfigHash,
  readAiUsageDays,
  createAiUsageJob,
  exportAiUsage,
} from "../ai-usage-server";
import { defaultAiUsagePolicy } from "../ai-usage-contract";
import { lockHousehold } from "../household-lock";
const run = process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
run("AI content-free quota reservations and lifecycle", () => {
  const families: string[] = [],
    users: string[] = [];
  let allowed = false;
  const previous = {
    ready: process.env.FAMILY_AI_USAGE_READY,
    rollback: process.env.FAMILY_AI_USAGE_ROLLBACK_READY,
    disabled: process.env.FAMILY_AI_PROVIDER_DISABLED,
  };
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env);
    allowed = true;
    expect(await aiUsageStorageAvailable(prisma!)).toBe(true);
    process.env.FAMILY_AI_USAGE_READY = "1";
    process.env.FAMILY_AI_USAGE_ROLLBACK_READY = "1";
    delete process.env.FAMILY_AI_PROVIDER_DISABLED;
  });
  afterAll(async () => {
    if (allowed) {
      assertFixtureTargetAllowed(process.env);
      await prisma!.family.deleteMany({ where: { id: { in: families } } });
      await prisma!.user.deleteMany({ where: { id: { in: users } } });
      await prisma!.$disconnect();
    }
    if (previous.ready === undefined) delete process.env.FAMILY_AI_USAGE_READY;
    else process.env.FAMILY_AI_USAGE_READY = previous.ready;
    if (previous.rollback === undefined)
      delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    else process.env.FAMILY_AI_USAGE_ROLLBACK_READY = previous.rollback;
    if (previous.disabled === undefined)
      delete process.env.FAMILY_AI_PROVIDER_DISABLED;
    else process.env.FAMILY_AI_PROVIDER_DISABLED = previous.disabled;
  });
  async function fixture() {
    const familyId = `ai-qa-${randomUUID()}`,
      userId = `ai-qa-${randomUUID()}`;
    families.push(familyId);
    users.push(userId);
    const config = {
      apiKey: "fabricated-private-fixture-key",
      baseUrl: "https://example.invalid",
      model: "fixture-model",
      userSuppliedUrl: true,
    };
    await prisma!.family.create({
      data: {
        id: familyId,
        name: "Isolated AI fixture",
        capture_ai_key_enc: encryptSecret(config.apiKey),
        capture_ai_base_url: config.baseUrl,
        capture_ai_model: config.model,
      },
      select: { id: true },
    });
    await prisma!.user.create({
      data: {
        id: userId,
        family_id: familyId,
        name: "Fixture parent",
        email: `${userId}@example.invalid`,
        role: "parent",
      },
      select: { id: true },
    });
    return { actor: { userId, familyId, generation: 0 }, config };
  }
  it("allows only one concurrent reservation at a one-call household limit and retains it after account erasure", async () => {
    const { actor, config } = await fixture(),
      foreign = await fixture();
    await prisma!.$transaction(async (tx) => {
      await lockHousehold(tx, actor.familyId);
      await saveAiUsagePolicy(
        tx,
        actor.familyId,
        0,
        { ...defaultAiUsagePolicy, dailyLimit: 1 },
        config,
      );
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        reserveAiUsage(prisma!, actor, config, "assistant", {
          inputBytes: 100,
          maxOutputTokens: 1300,
        }),
      ),
    );
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    for (const item of attempts)
      if (item.status === "rejected") expect(item.reason.status).toBe(429);
    await expect(
      reserveAiUsage(
        prisma!,
        { ...actor, familyId: foreign.actor.familyId },
        config,
        "assistant",
        { inputBytes: 100, maxOutputTokens: 1300 },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await readAiUsageDays(prisma!, foreign.actor.familyId)).toEqual([]);
    const exported = await exportAiUsage(
      prisma!,
      actor.userId,
      actor.familyId,
      "parent",
    );
    expect(exported?.ownRequests).toHaveLength(1);
    expect(JSON.stringify(exported)).not.toMatch(
      /fabricated-private-fixture-key|example.invalid|priced_config_hash/,
    );
    await prisma!.user.delete({
      where: { id: actor.userId },
      select: { id: true },
    });
    const rows = await prisma!.$queryRaw<
      Array<{ user_id: string | null }>
    >`SELECT "user_id" FROM "AiUsageRequest" WHERE "family_id"=${actor.familyId}`;
    expect(rows).toEqual([{ user_id: null }]);
    expect((await readAiUsageDays(prisma!, actor.familyId))[0].attempts).toBe(
      1,
    );
    await prisma!.family.delete({
      where: { id: actor.familyId },
      select: { id: true },
    });
    expect(await readAiUsageDays(prisma!, actor.familyId)).toEqual([]);
  });
  it("binds rates to the reviewed provider and withholds budget admission after provider changes", async () => {
    const { actor, config } = await fixture();
    const policy = {
      ...defaultAiUsagePolicy,
      monthlyBudgetMicrousd: "1000000",
      inputRateMicrousdPerMillion: "1000000",
      outputRateMicrousdPerMillion: "2000000",
    };
    await prisma!.$transaction(async (tx) => {
      await lockHousehold(tx, actor.familyId);
      expect(
        await saveAiUsagePolicy(tx, actor.familyId, 0, policy, config),
      ).toBe(1);
      expect(
        await saveAiUsagePolicy(tx, actor.familyId, 0, policy, config),
      ).toBeNull();
    });
    expect(aiConfigHash({ ...config, model: "changed" })).not.toBe(
      aiConfigHash(config),
    );
    await prisma!.family.update({
      where: { id: actor.familyId },
      data: { capture_ai_model: "changed" },
      select: { id: true },
    });
    await expect(
      reserveAiUsage(
        prisma!,
        actor,
        { ...config, model: "changed" },
        "assistant",
        { inputBytes: 100, maxOutputTokens: 1300 },
      ),
    ).rejects.toMatchObject({ code: "AI_PRICE_UNAVAILABLE" });
    expect(await readAiUsageDays(prisma!, actor.familyId)).toEqual([]);
  });
  it("withholds a reply after a policy change and finalizes a reservation only once", async () => {
    const { actor, config } = await fixture();
    const job = createAiUsageJob(prisma!, actor, config, "assistant");
    if (!job) throw new Error("Expected adopted usage controller");
    await job.observer.start({ inputBytes: 100, maxOutputTokens: 1300 });
    job.observer.reported({ inputTokens: 12, outputTokens: 30 });
    await prisma!.$transaction(async (tx) => {
      await lockHousehold(tx, actor.familyId);
      await saveAiUsagePolicy(
        tx,
        actor.familyId,
        0,
        { ...defaultAiUsagePolicy, enabled: false },
        config,
      );
    });
    expect(await job.replyAllowed()).toBe(false);
    await job.finish(409);
    await job.finish(200);
    const days = await readAiUsageDays(prisma!, actor.familyId);
    expect(days[0]).toMatchObject({
      attempts: 1,
      accepted: 0,
      refused: 1,
      unfinished: 0,
      inputTokens: "12",
      outputTokens: "30",
      unknownCostCalls: 1,
    });
  });
});
