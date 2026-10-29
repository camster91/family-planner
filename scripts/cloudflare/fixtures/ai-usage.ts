import { encryptSecret } from "../../../src/lib/secret-box";
import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  createD1AiUsageJob,
  readD1AiUsageDays,
  readD1AiUsagePolicy,
  reserveD1AiUsage,
  saveD1AiUsagePolicy,
} from "../../../src/lib/cloudflare/ai-usage";
import { AiUsageError } from "../../../src/lib/ai-usage-errors";
import { defaultAiUsagePolicy } from "../../../src/lib/ai-usage-contract";
import { resolveCaptureConfig } from "../../../src/lib/capture";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const actor = {
  userId: "ai-usage-parent",
  familyId: "ai-usage-family",
  role: "parent",
  generation: 0,
} as const;

/** Fabricated D1 usage accounting. It never calls a provider. */
export async function testAiUsage(db: D1Store) {
  const previous = {
    jwt: process.env.JWT_SECRET,
    ready: process.env.FAMILY_AI_USAGE_READY,
    rollback: process.env.FAMILY_AI_USAGE_ROLLBACK_READY,
  };
  process.env.JWT_SECRET = "fixture-ai-usage-jwt-secret";
  process.env.FAMILY_AI_USAGE_READY = "1";
  process.env.FAMILY_AI_USAGE_ROLLBACK_READY = "1";
  try {
    const encrypted = encryptSecret("fixture-provider-key");
    await db.batch([
      db
        .prepare(
          `INSERT INTO Family(id,name,invite_code,features,capture_ai_key_enc,capture_ai_base_url,capture_ai_model) VALUES ('ai-usage-family','AI usage fixture','ai-usage-code','{"meals":true}',?1,'https://provider.example.test/v1','fixture-model')`,
        )
        .bind(encrypted),
      db.prepare(
        `INSERT INTO User(id,email,name,role,family_id,email_verified,token_version) VALUES ('ai-usage-parent','ai-usage-parent@example.test','AI Parent','parent','ai-usage-family',1,0)`,
      ),
    ]);
    const family = await db
      .prepare(
        `SELECT capture_ai_key_enc,capture_ai_base_url,capture_ai_model FROM Family WHERE id=?1`,
      )
      .bind(actor.familyId)
      .first<{
        capture_ai_key_enc: string | null;
        capture_ai_base_url: string | null;
        capture_ai_model: string | null;
      }>();
    const config = resolveCaptureConfig(family);
    check(config, "fixture provider config");

    const policy = {
      ...defaultAiUsagePolicy,
      dailyLimit: 1,
      userDailyLimit: 1,
      inputRateMicrousdPerMillion: "1000000",
      outputRateMicrousdPerMillion: "1000000",
      monthlyBudgetMicrousd: "1000000",
    };
    check(
      (await saveD1AiUsagePolicy(db, actor.familyId, 0, policy, config)) === 1,
      "fixture policy create",
    );
    const saved = await readD1AiUsagePolicy(db, actor.familyId);
    check(saved.revision === 1 && saved.policy.dailyLimit === 1, "policy read");

    const reserved = await reserveD1AiUsage(
      db,
      actor,
      config,
      "assistant",
      { inputBytes: 100, maxOutputTokens: 100 },
      new Date("2026-10-28T12:00:00.000Z"),
    );
    check(Boolean(reserved.id), "usage reservation");
    const request = await db
      .prepare(
        `SELECT outcome,reserved_microusd FROM AiUsageRequest WHERE id=?1`,
      )
      .bind(reserved.id)
      .first<{ outcome: string; reserved_microusd: number | null }>();
    check(
      request?.outcome === "pending" && request.reserved_microusd !== null,
      "pending reservation",
    );

    let quota = false;
    try {
      await reserveD1AiUsage(
        db,
        actor,
        config,
        "assistant",
        { inputBytes: 100, maxOutputTokens: 100 },
        new Date("2026-10-28T12:01:00.000Z"),
      );
    } catch (error) {
      quota =
        error instanceof AiUsageError && error.code === "AI_QUOTA_REACHED";
    }
    check(quota, "daily and user cap admission");

    const job = createD1AiUsageJob(db, { ...actor }, config, "assistant");
    check(job, "usage job adoption");
    const restoredPolicy = {
      ...policy,
      dailyLimit: 5,
      userDailyLimit: 5,
    };
    check(
      (await saveD1AiUsagePolicy(
        db,
        actor.familyId,
        1,
        restoredPolicy,
        config,
      )) === 2,
      "policy revision update",
    );
    await job.observer.start({ inputBytes: 200, maxOutputTokens: 100 });
    job.observer.reported({ inputTokens: 10, outputTokens: 20 });
    check(await job.replyAllowed(), "reply remains admitted");
    await job.finish(200);
    const acceptedId = await db
      .prepare(`SELECT id FROM AiUsageRequest WHERE outcome='accepted' LIMIT 1`)
      .first<{ id: string }>();
    const finished = await db
      .prepare(
        `SELECT outcome,input_tokens,output_tokens,estimated_microusd FROM AiUsageRequest WHERE id=?1`,
      )
      .bind(acceptedId?.id ?? "")
      .first<{
        outcome: string;
        input_tokens: number | null;
        output_tokens: number | null;
        estimated_microusd: number | null;
      }>();
    check(
      finished?.outcome === "accepted" &&
        finished.input_tokens === 10 &&
        finished.output_tokens === 20,
      "usage settlement",
    );

    await db
      .prepare(`UPDATE User SET token_version=1 WHERE id=?1`)
      .bind(actor.userId)
      .run();
    check(!(await job.replyAllowed()), "revoked household reply refusal");
    const days = await readD1AiUsageDays(db, actor.familyId, new Date());
    check(
      days.some((day) => day.accepted === 1),
      "usage day report",
    );

    process.env.FAMILY_AI_USAGE_READY = "0";
    let paused = false;
    try {
      await reserveD1AiUsage(db, actor, config, "assistant", {
        inputBytes: 100,
        maxOutputTokens: 100,
      });
    } catch (error) {
      paused = error instanceof AiUsageError && error.code === "AI_PAUSED";
    }
    check(paused, "rollback pause refusal");
    return {
      policy: true,
      reservation: true,
      quota: true,
      settlement: true,
      revokedAuthority: true,
      rollback: true,
    };
  } finally {
    if (previous.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previous.jwt;
    if (previous.ready === undefined) delete process.env.FAMILY_AI_USAGE_READY;
    else process.env.FAMILY_AI_USAGE_READY = previous.ready;
    if (previous.rollback === undefined)
      delete process.env.FAMILY_AI_USAGE_ROLLBACK_READY;
    else process.env.FAMILY_AI_USAGE_ROLLBACK_READY = previous.rollback;
  }
}
