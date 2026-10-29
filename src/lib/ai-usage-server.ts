import { isAiUsageReady, isAiUsageAdopted } from "./ai-usage-gates";
/** Request reservations and parent reporting, with no prompt/model/URL storage. */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockUser, lockHousehold } from "./household-lock";
import { resolveCaptureConfig, type CaptureConfig } from "./capture";
import {
  aiUsagePolicy,
  defaultAiUsagePolicy,
  estimateAiMicrousd,
  reportedTokenCount,
  type AiUsagePolicy,
  type ProviderUsageObserver,
} from "./ai-usage-contract";
import { AiUsageError } from "./ai-usage-errors";
import { aiConfigHash } from "./ai-usage-hash";
import type { D1Store } from "./cloudflare/database";
import {
  createD1AiUsageJob,
  d1AiUsageStorageAvailable,
  exportD1AiUsage,
  readD1AiUsageDays,
  readD1AiUsagePolicy,
  reserveD1AiUsage,
  saveD1AiUsagePolicy,
} from "./cloudflare/ai-usage";
export { AiUsageError } from "./ai-usage-errors";
export { aiConfigHash } from "./ai-usage-hash";
type Tx = Prisma.TransactionClient;
type Raw = Pick<Tx, "$queryRaw" | "$executeRaw">;
type UsageDb = Pick<PrismaClient, "$transaction"> | D1Store;
export type AiUsageActor = {
  userId: string;
  familyId: string;
  generation: number;
  role?: string;
};
export type AiUsageJob = ReturnType<typeof createAiUsageJob>;
export { isAiUsageReady, isAiUsageAdopted } from "./ai-usage-gates";
function isD1UsageDb(value: unknown): value is D1Store {
  return Boolean(
    value &&
    typeof (value as D1Store).prepare === "function" &&
    typeof (value as D1Store).withSession === "function",
  );
}
export async function aiUsageStorageAvailable(
  tx: Pick<Tx, "$queryRaw"> | D1Store,
) {
  if (isD1UsageDb(tx)) return d1AiUsageStorageAvailable(tx);
  const rows = await tx.$queryRaw<
    Array<{ ready: boolean }>
  >`SELECT to_regclass('public."AiUsagePolicy"') IS NOT NULL AND to_regclass('public."AiUsageRequest"') IS NOT NULL
    AND (SELECT COUNT(*)=3 FROM pg_constraint WHERE contype='f' AND convalidated AND (
      (conrelid=to_regclass('public."AiUsagePolicy"') AND confrelid=to_regclass('public."Family"') AND conname='AiUsagePolicy_family_id_fkey' AND confdeltype='c') OR
      (conrelid=to_regclass('public."AiUsageRequest"') AND confrelid=to_regclass('public."Family"') AND conname='AiUsageRequest_family_id_fkey' AND confdeltype='c') OR
      (conrelid=to_regclass('public."AiUsageRequest"') AND confrelid=to_regclass('public."User"') AND conname='AiUsageRequest_user_id_fkey' AND confdeltype='n')
    )) AS ready`;
  return rows[0]?.ready === true;
}
export async function readAiUsagePolicy(
  tx: Pick<Tx, "$queryRaw"> | D1Store,
  familyId: string,
) {
  if (isD1UsageDb(tx)) return readD1AiUsagePolicy(tx, familyId);
  const rows = await tx.$queryRaw<
    Array<{
      revision: number;
      enabled: boolean;
      daily_limit: number;
      user_daily_limit: number;
      budget: string | null;
      input_rate: string | null;
      output_rate: string | null;
      priced_config_hash: string | null;
    }>
  >`
    SELECT "revision","enabled","daily_limit","user_daily_limit","monthly_budget_microusd"::text AS budget,"input_rate"::text,"output_rate"::text,"priced_config_hash"
    FROM "AiUsagePolicy" WHERE "family_id"=${familyId}`;
  const row = rows[0];
  return row
    ? {
        revision: row.revision,
        pricedConfigHash: row.priced_config_hash,
        policy: aiUsagePolicy.parse({
          enabled: row.enabled,
          dailyLimit: row.daily_limit,
          userDailyLimit: row.user_daily_limit,
          monthlyBudgetMicrousd: row.budget,
          inputRateMicrousdPerMillion: row.input_rate,
          outputRateMicrousdPerMillion: row.output_rate,
        }),
      }
    : {
        revision: 0,
        pricedConfigHash: null,
        policy: { ...defaultAiUsagePolicy },
      };
}
export function aiUtcWindow(now: Date) {
  if (!Number.isFinite(now.getTime()))
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    day,
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    tomorrow: new Date(day.getTime() + 86400000),
    reportStart: new Date(day.getTime() - 30 * 86400000),
    retention: new Date(day.getTime() - 90 * 86400000),
  };
}
export async function reserveAiUsage(
  db: UsageDb,
  actor: AiUsageActor,
  config: CaptureConfig,
  job: "assistant" | "capture_text" | "capture_photo",
  input: { inputBytes: number; maxOutputTokens: number },
  now = new Date(),
) {
  if (isD1UsageDb(db))
    return reserveD1AiUsage(db, actor, config, job, input, now);
  if (!isAiUsageReady() || process.env.FAMILY_AI_PROVIDER_DISABLED === "1")
    throw new AiUsageError("AI_PAUSED");
  if (
    !Number.isSafeInteger(input.inputBytes) ||
    input.inputBytes < 0 ||
    input.inputBytes > 8_000_000 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 4096
  )
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  const window = aiUtcWindow(now);
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const user = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    });
    if (
      !user ||
      user.family_id !== actor.familyId ||
      user.token_version !== actor.generation ||
      !["parent", "teen"].includes(user.role)
    )
      throw new AiUsageError("AI_SOURCE_CHANGED", 409);
    if (!(await aiUsageStorageAvailable(tx)))
      throw new AiUsageError("AI_USAGE_UNAVAILABLE");
    const family = await tx.family.findUnique({
      where: { id: actor.familyId },
      select: {
        capture_ai_key_enc: true,
        capture_ai_base_url: true,
        capture_ai_model: true,
      },
    });
    const currentConfig = resolveCaptureConfig(family);
    if (
      !currentConfig ||
      JSON.stringify(currentConfig) !== JSON.stringify(config)
    )
      throw new AiUsageError("AI_SOURCE_CHANGED", 409);
    const { policy, pricedConfigHash, revision } = await readAiUsagePolicy(
      tx,
      actor.familyId,
    );
    if (!policy.enabled) throw new AiUsageError("AI_PAUSED");
    const pricingCurrent = pricedConfigHash === aiConfigHash(config);
    const activePricing = pricingCurrent
      ? policy
      : {
          ...policy,
          inputRateMicrousdPerMillion: null,
          outputRateMicrousdPerMillion: null,
        };
    // This is a conservative application estimate, not a provider billing cap.
    // Vision billing/tokenization may differ; unknown actuals retain reservation.
    const reserve = estimateAiMicrousd(
      input.inputBytes + 1024,
      input.maxOutputTokens,
      activePricing,
    );
    if (policy.monthlyBudgetMicrousd !== null && reserve === null)
      throw new AiUsageError("AI_PRICE_UNAVAILABLE");
    const rows = await tx.$queryRaw<
      Array<{
        family_day: number;
        user_day: number;
        month_cost: string;
        unknown_cost: number;
      }>
    >`
      SELECT COUNT(*) FILTER (WHERE "family_id"=${actor.familyId} AND "created_at">=${window.day})::int AS family_day,
        COUNT(*) FILTER (WHERE "user_id"=${actor.userId} AND "created_at">=${window.day})::int AS user_day,
        COALESCE(SUM(COALESCE("estimated_microusd","reserved_microusd",0)) FILTER (WHERE "family_id"=${actor.familyId}),0)::text AS month_cost,
        COUNT(*) FILTER (WHERE "family_id"=${actor.familyId} AND "estimated_microusd" IS NULL AND "reserved_microusd" IS NULL)::int AS unknown_cost
      FROM "AiUsageRequest" WHERE "created_at">=${window.month} AND ("family_id"=${actor.familyId} OR "user_id"=${actor.userId})`;
    const counts = rows[0];
    if (!counts) throw new AiUsageError("AI_USAGE_UNAVAILABLE");
    if (
      counts.family_day >= policy.dailyLimit ||
      counts.user_day >= policy.userDailyLimit ||
      (policy.monthlyBudgetMicrousd !== null &&
        (counts.unknown_cost > 0 ||
          BigInt(counts.month_cost) + BigInt(reserve!) >
            BigInt(policy.monthlyBudgetMicrousd)))
    )
      throw new AiUsageError("AI_QUOTA_REACHED", 429);
    const id = randomUUID();
    await tx.$executeRaw`INSERT INTO "AiUsageRequest" ("id","family_id","user_id","job","created_at","input_rate","output_rate","reserved_microusd")
      VALUES (${id},${actor.familyId},${actor.userId},${job},${now},${activePricing.inputRateMicrousdPerMillion}::bigint,${activePricing.outputRateMicrousdPerMillion}::bigint,${reserve}::bigint)`;
    // Lazy bounded retention, never a scheduler or cleanup of another family.
    await tx.$executeRaw`DELETE FROM "AiUsageRequest" WHERE "id" IN (SELECT "id" FROM "AiUsageRequest" WHERE "family_id"=${actor.familyId} AND "created_at"<${window.retention} ORDER BY "created_at","id" LIMIT 500)`;
    return { id, policy: activePricing, policyRevision: revision };
  });
}
export function createAiUsageJob(
  db: UsageDb,
  actor: AiUsageActor,
  config: CaptureConfig,
  job: "assistant" | "capture_text" | "capture_photo",
) {
  if (isD1UsageDb(db)) return createD1AiUsageJob(db, actor, config, job);
  if (!isAiUsageAdopted()) return undefined;
  let reservation: Awaited<ReturnType<typeof reserveAiUsage>> | null = null;
  let startedAt: number | null = null,
    finished = false;
  let providerStatus: "unconfirmed" | "response" | "timeout" | "error" =
    "unconfirmed";
  let inputTokens: number | null = null,
    outputTokens: number | null = null;
  const observer: ProviderUsageObserver = {
    async start(input) {
      if (reservation || startedAt !== null)
        throw new AiUsageError("AI_USAGE_UNAVAILABLE");
      startedAt = Date.now();
      try {
        reservation = await reserveAiUsage(db, actor, config, job, input);
        if (
          !isAiUsageReady() ||
          process.env.FAMILY_AI_PROVIDER_DISABLED === "1"
        )
          throw new AiUsageError("AI_PAUSED");
      } catch (error) {
        if (error instanceof AiUsageError) throw error;
        throw new AiUsageError("AI_USAGE_UNAVAILABLE");
      }
      startedAt = Date.now();
    },
    reported(usage) {
      providerStatus = "response";
      inputTokens = reportedTokenCount(usage.inputTokens);
      outputTokens = reportedTokenCount(usage.outputTokens);
    },
    failed(reason) {
      providerStatus = reason;
    },
  };
  return {
    observer,
    async replyAllowed() {
      if (!reservation) return true;
      if (!isAiUsageReady() || process.env.FAMILY_AI_PROVIDER_DISABLED === "1")
        return false;
      const expected = reservation;
      try {
        return await db.$transaction(async (tx) => {
          await lockUser(tx, actor.userId);
          await lockHousehold(tx, actor.familyId);
          const current = await tx.user.findUnique({
            where: { id: actor.userId },
            select: { family_id: true, role: true, token_version: true },
          });
          if (
            !current ||
            current.family_id !== actor.familyId ||
            current.token_version !== actor.generation ||
            !["parent", "teen"].includes(current.role)
          )
            return false;
          const saved = await readAiUsagePolicy(tx, actor.familyId);
          if (
            !saved.policy.enabled ||
            saved.revision !== expected.policyRevision
          )
            return false;
          const family = await tx.family.findUnique({
            where: { id: actor.familyId },
            select: {
              capture_ai_key_enc: true,
              capture_ai_base_url: true,
              capture_ai_model: true,
            },
          });
          const currentConfig = resolveCaptureConfig(family);
          return Boolean(
            currentConfig &&
            JSON.stringify(currentConfig) === JSON.stringify(config) &&
            isAiUsageReady() &&
            process.env.FAMILY_AI_PROVIDER_DISABLED !== "1",
          );
        });
      } catch {
        return false;
      }
    },
    async finish(status: number) {
      if (!reservation || finished) return;
      finished = true;
      const now = new Date(),
        elapsed = startedAt === null ? null : now.getTime() - startedAt;
      const latency =
        elapsed !== null &&
        Number.isFinite(elapsed) &&
        elapsed >= 0 &&
        elapsed <= 300000
          ? Math.floor(elapsed)
          : null;
      const cost =
        inputTokens === null || outputTokens === null
          ? null
          : estimateAiMicrousd(inputTokens, outputTokens, reservation.policy);
      const outcome =
        status >= 200 && status < 300
          ? "accepted"
          : status >= 400 && status < 500
            ? "refused"
            : "failed";
      const requestId = reservation.id;
      try {
        await db.$transaction(async (tx) => {
          await lockHousehold(tx, actor.familyId);
          await tx.$executeRaw`UPDATE "AiUsageRequest" SET "finished_at"=${now},"outcome"=${outcome},"provider_status"=${providerStatus},"latency_ms"=${latency},"input_tokens"=${inputTokens},"output_tokens"=${outputTokens},"estimated_microusd"=${cost}::bigint
        WHERE "id"=${requestId} AND "family_id"=${actor.familyId} AND "outcome"='pending'`;
        });
      } catch {
        console.warn(
          "ai.usage_finalization_unavailable",
        ); /* Reservation remains conservative; never dispatch/retry again. */
      }
    },
  };
}
export async function readAiUsageDays(
  tx: Pick<Tx, "$queryRaw"> | D1Store,
  familyId: string,
  now = new Date(),
) {
  if (isD1UsageDb(tx)) return readD1AiUsageDays(tx, familyId, now);
  const window = aiUtcWindow(now);
  return tx.$queryRaw<
    Array<{
      day: string;
      attempts: number;
      accepted: number;
      refused: number;
      failed: number;
      unfinished: number;
      timeouts: number;
      inputTokens: string;
      outputTokens: string;
      unknownTokenCalls: number;
      estimatedMicrousd: string;
      reservedMicrousd: string;
      unknownCostCalls: number;
      latencyTotalMs: string;
      measuredCalls: number;
    }>
  >`
    SELECT to_char("created_at" AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,COUNT(*)::int AS attempts,
      COUNT(*) FILTER(WHERE "outcome"='accepted')::int AS accepted,COUNT(*) FILTER(WHERE "outcome"='refused')::int AS refused,
      COUNT(*) FILTER(WHERE "outcome"='failed')::int AS failed,COUNT(*) FILTER(WHERE "outcome"='pending')::int AS unfinished,
      COUNT(*) FILTER(WHERE "provider_status"='timeout')::int AS timeouts,
      COALESCE(SUM("input_tokens"),0)::text AS "inputTokens",COALESCE(SUM("output_tokens"),0)::text AS "outputTokens",
      COUNT(*) FILTER(WHERE "input_tokens" IS NULL OR "output_tokens" IS NULL)::int AS "unknownTokenCalls",
      COALESCE(SUM("estimated_microusd"),0)::text AS "estimatedMicrousd",
      COALESCE(SUM("reserved_microusd") FILTER(WHERE "estimated_microusd" IS NULL),0)::text AS "reservedMicrousd",
      COUNT(*) FILTER(WHERE "estimated_microusd" IS NULL AND "reserved_microusd" IS NULL)::int AS "unknownCostCalls",
      COALESCE(SUM("latency_ms"),0)::text AS "latencyTotalMs",COUNT("latency_ms")::int AS "measuredCalls"
    FROM "AiUsageRequest" WHERE "family_id"=${familyId} AND "created_at">=${window.reportStart} AND "created_at"<${window.tomorrow}
    GROUP BY 1 ORDER BY 1 DESC LIMIT 31`;
}
export async function saveAiUsagePolicy(
  tx: Raw | D1Store,
  familyId: string,
  expectedRevision: number,
  policy: AiUsagePolicy,
  config: CaptureConfig | null,
) {
  if (isD1UsageDb(tx))
    return saveD1AiUsagePolicy(tx, familyId, expectedRevision, policy, config);
  const hash =
    config && policy.inputRateMicrousdPerMillion !== null
      ? aiConfigHash(config)
      : null;
  if (policy.inputRateMicrousdPerMillion !== null && !config)
    throw new AiUsageError("AI_PRICE_UNAVAILABLE");
  const count =
    await tx.$executeRaw`INSERT INTO "AiUsagePolicy" ("family_id","revision","enabled","daily_limit","user_daily_limit","monthly_budget_microusd","input_rate","output_rate","priced_config_hash")
    SELECT ${familyId},1,${policy.enabled},${policy.dailyLimit},${policy.userDailyLimit},${policy.monthlyBudgetMicrousd}::bigint,${policy.inputRateMicrousdPerMillion}::bigint,${policy.outputRateMicrousdPerMillion}::bigint,${hash} WHERE ${expectedRevision}=0
    ON CONFLICT ("family_id") DO NOTHING`;
  if (count === 1) return 1;
  const changed = await tx.$queryRaw<
    Array<{ revision: number }>
  >`UPDATE "AiUsagePolicy" SET "revision"="revision"+1,"enabled"=${policy.enabled},"daily_limit"=${policy.dailyLimit},"user_daily_limit"=${policy.userDailyLimit},"monthly_budget_microusd"=${policy.monthlyBudgetMicrousd}::bigint,"input_rate"=${policy.inputRateMicrousdPerMillion}::bigint,"output_rate"=${policy.outputRateMicrousdPerMillion}::bigint,"priced_config_hash"=${hash},"updated_at"=now()
    WHERE "family_id"=${familyId} AND "revision"=${expectedRevision} AND "revision"<2147483647 RETURNING "revision"`;
  return changed[0]?.revision ?? null;
}

/** Portability follows the existing own-account export. No prices, provider
 * configuration, family IDs or other people's request attribution in own rows. */
export async function exportAiUsage(
  db: Pick<Tx, "$queryRaw"> | D1Store,
  userId: string,
  familyId: string | null,
  role: string | undefined,
) {
  if (isD1UsageDb(db)) return exportD1AiUsage(db, userId, familyId, role);
  if (!(await aiUsageStorageAvailable(db))) return undefined;
  const ownRequests = await db.$queryRaw<
    Array<{
      id: string;
      job: string;
      created_at: Date;
      finished_at: Date | null;
      outcome: string;
      provider_status: string;
      latency_ms: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }>
  >`
    SELECT "id","job","created_at","finished_at","outcome","provider_status","latency_ms","input_tokens","output_tokens"
    FROM "AiUsageRequest" WHERE "user_id"=${userId} ORDER BY "created_at","id"`;
  const policies =
    role === "parent" && familyId
      ? await db.$queryRaw<
          Array<{
            enabled: boolean;
            daily_limit: number;
            user_daily_limit: number;
            monthly_budget_microusd: string | null;
            input_rate: string | null;
            output_rate: string | null;
            revision: number;
          }>
        >`
    SELECT "enabled","daily_limit","user_daily_limit","monthly_budget_microusd"::text,"input_rate"::text,"output_rate"::text,"revision"
    FROM "AiUsagePolicy" p WHERE p."family_id"=${familyId} AND EXISTS(SELECT 1 FROM "User" u WHERE u."id"=${userId} AND u."family_id"=p."family_id" AND u."role"='parent')`
      : [];
  return {
    ownRequests,
    ...(policies[0] ? { currentHouseholdPolicy: policies[0] } : {}),
  };
}
