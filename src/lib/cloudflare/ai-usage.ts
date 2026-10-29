/** Native D1 AI usage reservations.  Prompts, provider replies and secrets
 * never enter this store; only bounded usage metadata and policy state do. */
import { randomUUID } from "node:crypto";
import { resolveCaptureConfig, type CaptureConfig } from "../capture";
import {
  aiUsagePolicy,
  defaultAiUsagePolicy,
  estimateAiMicrousd,
  reportedTokenCount,
  type AiUsagePolicy,
  type ProviderUsageObserver,
} from "../ai-usage-contract";
import { AiUsageError } from "../ai-usage-errors";
import { aiConfigHash } from "../ai-usage-hash";
import { isAiUsageAdopted, isAiUsageReady } from "../ai-usage-gates";
import type { D1Store } from "./database";

export type D1AiUsageActor = {
  userId: string;
  familyId: string;
  generation: number;
  role?: string;
};
export type D1AiUsageJob = {
  observer: ProviderUsageObserver;
  replyAllowed: () => Promise<boolean>;
  finish: (status: number) => Promise<void>;
};
type UsageJob = "assistant" | "capture_text" | "capture_photo";
type PolicyRow = {
  revision: number;
  enabled: number;
  daily_limit: number;
  user_daily_limit: number;
  monthly_budget_microusd: number | string | null;
  input_rate: number | string | null;
  output_rate: number | string | null;
  priced_config_hash: string | null;
};

const sessionOf = (db: D1Store) => db.withSession("first-primary");
const micros = (value: number | string | null) =>
  value === null ? null : String(value);
const sqlMicros = (value: string | null) =>
  value === null ? null : Number(value);

export async function d1AiUsageStorageAvailable(db: D1Store) {
  try {
    const row = await sessionOf(db)
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('AiUsagePolicy','AiUsageRequest')`,
      )
      .first<{ count: number }>();
    return row?.count === 2;
  } catch {
    return false;
  }
}

async function rawPolicy(db: D1Store, familyId: string) {
  return sessionOf(db)
    .prepare(
      `SELECT revision,enabled,daily_limit,user_daily_limit,monthly_budget_microusd,input_rate,output_rate,priced_config_hash
       FROM "AiUsagePolicy" WHERE family_id=?1`,
    )
    .bind(familyId)
    .first<PolicyRow>();
}

export async function readD1AiUsagePolicy(db: D1Store, familyId: string) {
  const row = await rawPolicy(db, familyId);
  if (!row)
    return {
      revision: 0,
      pricedConfigHash: null,
      policy: { ...defaultAiUsagePolicy },
    };
  try {
    return {
      revision: row.revision,
      pricedConfigHash: row.priced_config_hash,
      policy: aiUsagePolicy.parse({
        enabled: row.enabled === 1,
        dailyLimit: row.daily_limit,
        userDailyLimit: row.user_daily_limit,
        monthlyBudgetMicrousd: micros(row.monthly_budget_microusd),
        inputRateMicrousdPerMillion: micros(row.input_rate),
        outputRateMicrousdPerMillion: micros(row.output_rate),
      }),
    };
  } catch {
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  }
}

function validateReservationInput(input: {
  inputBytes: number;
  maxOutputTokens: number;
}) {
  if (
    !Number.isSafeInteger(input.inputBytes) ||
    input.inputBytes < 0 ||
    input.inputBytes > 8_000_000 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > 4096
  )
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
}

function utcWindow(now: Date) {
  if (!Number.isFinite(now.getTime()))
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    day: day.getTime(),
    month: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).getTime(),
    tomorrow: day.getTime() + 86400000,
    reportStart: day.getTime() - 30 * 86400000,
    retention: day.getTime() - 90 * 86400000,
  };
}

async function currentAuthority(
  db: D1Store,
  actor: D1AiUsageActor,
  config: CaptureConfig,
) {
  const user = await sessionOf(db)
    .prepare(`SELECT family_id,role,token_version FROM "User" WHERE id=?1`)
    .bind(actor.userId)
    .first<{ family_id: string | null; role: string; token_version: number }>();
  if (
    !user ||
    user.family_id !== actor.familyId ||
    user.role !== actor.role ||
    user.token_version !== actor.generation ||
    !["parent", "teen"].includes(user.role)
  )
    return false;
  const family = await sessionOf(db)
    .prepare(
      `SELECT capture_ai_key_enc,capture_ai_base_url,capture_ai_model FROM "Family" WHERE id=?1`,
    )
    .bind(actor.familyId)
    .first<{
      capture_ai_key_enc: string | null;
      capture_ai_base_url: string | null;
      capture_ai_model: string | null;
    }>();
  const current = resolveCaptureConfig(family);
  return Boolean(current && JSON.stringify(current) === JSON.stringify(config));
}

/** Reserve in one D1 INSERT ... SELECT.  The cap predicates run in the write
 * statement itself, so two concurrent Worker requests cannot both pass a
 * stale count read. */
export async function reserveD1AiUsage(
  db: D1Store,
  actor: D1AiUsageActor,
  config: CaptureConfig,
  job: UsageJob,
  input: { inputBytes: number; maxOutputTokens: number },
  now = new Date(),
) {
  if (!isAiUsageReady() || process.env.FAMILY_AI_PROVIDER_DISABLED === "1")
    throw new AiUsageError("AI_PAUSED");
  validateReservationInput(input);
  if (!(await d1AiUsageStorageAvailable(db)))
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  const window = utcWindow(now);
  const family = await sessionOf(db)
    .prepare(
      `SELECT capture_ai_key_enc,capture_ai_base_url,capture_ai_model FROM "Family" WHERE id=?1`,
    )
    .bind(actor.familyId)
    .first<{
      capture_ai_key_enc: string | null;
      capture_ai_base_url: string | null;
      capture_ai_model: string | null;
    }>();
  const currentConfig = resolveCaptureConfig(family);
  if (
    !currentConfig ||
    JSON.stringify(currentConfig) !== JSON.stringify(config)
  )
    throw new AiUsageError("AI_SOURCE_CHANGED", 409);
  const saved = await readD1AiUsagePolicy(db, actor.familyId);
  if (!saved.policy.enabled) throw new AiUsageError("AI_PAUSED");
  const priced = saved.pricedConfigHash === aiConfigHash(config);
  const active = priced
    ? saved.policy
    : {
        ...saved.policy,
        inputRateMicrousdPerMillion: null,
        outputRateMicrousdPerMillion: null,
      };
  const reserve = estimateAiMicrousd(
    input.inputBytes + 1024,
    input.maxOutputTokens,
    active,
  );
  if (saved.policy.monthlyBudgetMicrousd !== null && reserve === null)
    throw new AiUsageError("AI_PRICE_UNAVAILABLE");
  const id = randomUUID();
  const store = sessionOf(db);
  const inserted = await store
    .prepare(
      `WITH policy AS (
        SELECT revision,enabled,daily_limit,user_daily_limit,monthly_budget_microusd
        FROM "AiUsagePolicy" WHERE family_id=?1
        UNION ALL
        SELECT 0,1,120,40,NULL
        WHERE NOT EXISTS (SELECT 1 FROM "AiUsagePolicy" WHERE family_id=?1)
      )
      INSERT INTO "AiUsageRequest"(id,family_id,user_id,job,created_at,outcome,provider_status,input_rate,output_rate,reserved_microusd)
      SELECT ?2,?1,?3,?4,?5,'pending','unconfirmed',?6,?7,?8
      FROM policy
      WHERE policy.enabled=1 AND policy.revision=?9
        AND EXISTS (
          SELECT 1 FROM "User" u
          WHERE u.id=?3 AND u.family_id=?1 AND u.role=?10
            AND u.role IN ('parent','teen') AND u.token_version=?11
        )
        AND EXISTS (
          SELECT 1 FROM "Family" f
          WHERE f.id=?1
            AND f.capture_ai_key_enc IS ?12
            AND f.capture_ai_base_url IS ?13
            AND f.capture_ai_model IS ?14
        )
        AND (SELECT COUNT(*) FROM "AiUsageRequest" r WHERE r.family_id=?1 AND r.created_at>=?15) < policy.daily_limit
        AND (SELECT COUNT(*) FROM "AiUsageRequest" r WHERE r.user_id=?3 AND r.created_at>=?15) < policy.user_daily_limit
        AND (
          policy.monthly_budget_microusd IS NULL OR
          (
            (SELECT COUNT(*) FROM "AiUsageRequest" r WHERE r.family_id=?1 AND r.created_at>=?16 AND r.estimated_microusd IS NULL AND r.reserved_microusd IS NULL)=0
            AND CAST(COALESCE((SELECT SUM(COALESCE(r.estimated_microusd,r.reserved_microusd,0)) FROM "AiUsageRequest" r WHERE r.created_at>=?16 AND (r.family_id=?1 OR r.user_id=?3)),0) AS INTEGER) + COALESCE(?8,0) <= policy.monthly_budget_microusd
          )
        )
      RETURNING id`,
    )
    .bind(
      actor.familyId,
      id,
      actor.userId,
      job,
      now.getTime(),
      sqlMicros(active.inputRateMicrousdPerMillion),
      sqlMicros(active.outputRateMicrousdPerMillion),
      sqlMicros(reserve),
      saved.revision,
      actor.role ?? "",
      actor.generation,
      family?.capture_ai_key_enc ?? null,
      family?.capture_ai_base_url ?? null,
      family?.capture_ai_model ?? null,
      window.day,
      window.month,
    )
    .first<{ id: string }>();
  if (!inserted) {
    if (!(await currentAuthority(db, actor, config)))
      throw new AiUsageError("AI_SOURCE_CHANGED", 409);
    const current = await readD1AiUsagePolicy(db, actor.familyId);
    if (!current.policy.enabled) throw new AiUsageError("AI_PAUSED");
    if (
      current.policy.monthlyBudgetMicrousd !== null &&
      estimateAiMicrousd(
        input.inputBytes + 1024,
        input.maxOutputTokens,
        current.policy,
      ) === null
    )
      throw new AiUsageError("AI_PRICE_UNAVAILABLE");
    throw new AiUsageError("AI_QUOTA_REACHED", 429);
  }
  await store
    .prepare(
      `DELETE FROM "AiUsageRequest" WHERE id IN (
        SELECT id FROM "AiUsageRequest"
        WHERE family_id=?1 AND created_at<?2 ORDER BY created_at,id LIMIT 500
      )`,
    )
    .bind(actor.familyId, window.retention)
    .run();
  return { id, policy: active, policyRevision: saved.revision };
}

export function createD1AiUsageJob(
  db: D1Store,
  actor: D1AiUsageActor,
  config: CaptureConfig,
  job: UsageJob,
) {
  if (!isAiUsageAdopted()) return undefined;
  let reservation: Awaited<ReturnType<typeof reserveD1AiUsage>> | null = null;
  let startedAt: number | null = null;
  let finished = false;
  let providerStatus: "unconfirmed" | "response" | "timeout" | "error" =
    "unconfirmed";
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  const observer: ProviderUsageObserver = {
    async start(input) {
      if (reservation || startedAt !== null)
        throw new AiUsageError("AI_USAGE_UNAVAILABLE");
      startedAt = Date.now();
      reservation = await reserveD1AiUsage(db, actor, config, job, input);
      if (!isAiUsageReady() || process.env.FAMILY_AI_PROVIDER_DISABLED === "1")
        throw new AiUsageError("AI_PAUSED");
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
      const current = await sessionOf(db)
        .prepare(
          `SELECT u.family_id,u.role,u.token_version,f.capture_ai_key_enc,f.capture_ai_base_url,f.capture_ai_model,p.revision,p.enabled
           FROM "User" u JOIN "Family" f ON f.id=u.family_id
           LEFT JOIN "AiUsagePolicy" p ON p.family_id=u.family_id
           WHERE u.id=?1`,
        )
        .bind(actor.userId)
        .first<{
          family_id: string | null;
          role: string;
          token_version: number;
          capture_ai_key_enc: string | null;
          capture_ai_base_url: string | null;
          capture_ai_model: string | null;
          revision: number | null;
          enabled: number | null;
        }>();
      const currentConfig = resolveCaptureConfig(current);
      return Boolean(
        current &&
        current.family_id === actor.familyId &&
        current.role === actor.role &&
        ["parent", "teen"].includes(current.role) &&
        current.token_version === actor.generation &&
        current.enabled !== 0 &&
        (current.revision ?? 0) === reservation.policyRevision &&
        currentConfig &&
        JSON.stringify(currentConfig) === JSON.stringify(config),
      );
    },
    async finish(status: number) {
      if (!reservation || finished) return;
      finished = true;
      const now = new Date();
      const elapsed = startedAt === null ? null : now.getTime() - startedAt;
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
      try {
        await sessionOf(db)
          .prepare(
            `UPDATE "AiUsageRequest"
             SET finished_at=?1,outcome=?2,provider_status=?3,latency_ms=?4,input_tokens=?5,output_tokens=?6,estimated_microusd=?7
             WHERE id=?8 AND family_id=?9 AND outcome='pending'`,
          )
          .bind(
            now.getTime(),
            outcome,
            providerStatus,
            latency,
            inputTokens,
            outputTokens,
            sqlMicros(cost),
            reservation.id,
            actor.familyId,
          )
          .run();
      } catch {
        console.warn("ai.usage_finalization_unavailable");
      }
    },
  } satisfies D1AiUsageJob;
}

export async function readD1AiUsageDays(
  db: D1Store,
  familyId: string,
  now = new Date(),
) {
  const window = utcWindow(now);
  const rows = await sessionOf(db)
    .prepare(
      `SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') AS day,
        COUNT(*) AS attempts,
        SUM(CASE WHEN outcome='accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN outcome='refused' THEN 1 ELSE 0 END) AS refused,
        SUM(CASE WHEN outcome='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN outcome='pending' THEN 1 ELSE 0 END) AS unfinished,
        SUM(CASE WHEN provider_status='timeout' THEN 1 ELSE 0 END) AS timeouts,
        COALESCE(SUM(input_tokens),0) AS inputTokens,
        COALESCE(SUM(output_tokens),0) AS outputTokens,
        SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) AS unknownTokenCalls,
        COALESCE(SUM(estimated_microusd),0) AS estimatedMicrousd,
        COALESCE(SUM(CASE WHEN estimated_microusd IS NULL THEN reserved_microusd ELSE 0 END),0) AS reservedMicrousd,
        SUM(CASE WHEN estimated_microusd IS NULL AND reserved_microusd IS NULL THEN 1 ELSE 0 END) AS unknownCostCalls,
        COALESCE(SUM(latency_ms),0) AS latencyTotalMs,
        SUM(CASE WHEN latency_ms IS NOT NULL THEN 1 ELSE 0 END) AS measuredCalls
       FROM "AiUsageRequest"
       WHERE family_id=?1 AND created_at>=?2 AND created_at<?3
       GROUP BY day ORDER BY day DESC LIMIT 31`,
    )
    .bind(familyId, window.reportStart, window.tomorrow)
    .all<{
      day: string;
      attempts: number;
      accepted: number;
      refused: number;
      failed: number;
      unfinished: number;
      timeouts: number;
      inputTokens: number | string;
      outputTokens: number | string;
      unknownTokenCalls: number;
      estimatedMicrousd: number | string;
      reservedMicrousd: number | string;
      unknownCostCalls: number;
      latencyTotalMs: number | string;
      measuredCalls: number;
    }>();
  return rows.results.map((row) => ({
    ...row,
    attempts: Number(row.attempts ?? 0),
    accepted: Number(row.accepted ?? 0),
    refused: Number(row.refused ?? 0),
    failed: Number(row.failed ?? 0),
    unfinished: Number(row.unfinished ?? 0),
    timeouts: Number(row.timeouts ?? 0),
    inputTokens: String(row.inputTokens ?? 0),
    outputTokens: String(row.outputTokens ?? 0),
    unknownTokenCalls: Number(row.unknownTokenCalls ?? 0),
    estimatedMicrousd: String(row.estimatedMicrousd ?? 0),
    reservedMicrousd: String(row.reservedMicrousd ?? 0),
    unknownCostCalls: Number(row.unknownCostCalls ?? 0),
    latencyTotalMs: String(row.latencyTotalMs ?? 0),
    measuredCalls: Number(row.measuredCalls ?? 0),
  }));
}

/**
 * Export only the caller's own usage rows.  The PostgreSQL export deliberately
 * omits family ids, prices, provider configuration and other members' rows;
 * keep that same portability boundary on native D1 so switching storage
 * backends cannot widen the data export.
 */
export async function exportD1AiUsage(
  db: D1Store,
  userId: string,
  familyId: string | null,
  role: string | undefined,
) {
  if (!(await d1AiUsageStorageAvailable(db))) return undefined;
  const store = sessionOf(db);
  const ownRows = await store
    .prepare(
      `SELECT id,job,created_at,finished_at,outcome,provider_status,
              latency_ms,input_tokens,output_tokens
         FROM "AiUsageRequest"
        WHERE user_id=?1
        ORDER BY created_at,id`,
    )
    .bind(userId)
    .all<{
      id: string;
      job: string;
      created_at: number;
      finished_at: number | null;
      outcome: string;
      provider_status: string;
      latency_ms: number | null;
      input_tokens: number | null;
      output_tokens: number | null;
    }>();
  const ownRequests = ownRows.results.map((row) => ({
    ...row,
    created_at: new Date(row.created_at),
    finished_at: row.finished_at === null ? null : new Date(row.finished_at),
  }));
  if (role !== "parent" || !familyId) return { ownRequests };
  const policy = await store
    .prepare(
      `SELECT enabled,daily_limit,user_daily_limit,
              monthly_budget_microusd,input_rate,output_rate,revision
         FROM "AiUsagePolicy" p
        WHERE p.family_id=?1
          AND EXISTS (
            SELECT 1 FROM "User" u
             WHERE u.id=?2 AND u.family_id=p.family_id AND u.role='parent'
          )`,
    )
    .bind(familyId, userId)
    .first<{
      enabled: number;
      daily_limit: number;
      user_daily_limit: number;
      monthly_budget_microusd: number | string | null;
      input_rate: number | string | null;
      output_rate: number | string | null;
      revision: number;
    }>();
  return {
    ownRequests,
    ...(policy
      ? {
          currentHouseholdPolicy: {
            enabled: policy.enabled === 1,
            daily_limit: policy.daily_limit,
            user_daily_limit: policy.user_daily_limit,
            monthly_budget_microusd:
              policy.monthly_budget_microusd === null
                ? null
                : String(policy.monthly_budget_microusd),
            input_rate:
              policy.input_rate === null ? null : String(policy.input_rate),
            output_rate:
              policy.output_rate === null ? null : String(policy.output_rate),
            revision: policy.revision,
          },
        }
      : {}),
  };
}

export async function saveD1AiUsagePolicy(
  db: D1Store,
  familyId: string,
  expectedRevision: number,
  policy: AiUsagePolicy,
  config: CaptureConfig | null,
) {
  const hash =
    config && policy.inputRateMicrousdPerMillion !== null
      ? aiConfigHash(config)
      : null;
  if (policy.inputRateMicrousdPerMillion !== null && !config)
    throw new AiUsageError("AI_PRICE_UNAVAILABLE");
  const store = sessionOf(db);
  const inserted = await store
    .prepare(
      `INSERT INTO "AiUsagePolicy"(family_id,revision,enabled,daily_limit,user_daily_limit,monthly_budget_microusd,input_rate,output_rate,priced_config_hash)
       SELECT ?1,1,?2,?3,?4,?5,?6,?7,?8 WHERE ?9=0
       ON CONFLICT(family_id) DO NOTHING`,
    )
    .bind(
      familyId,
      policy.enabled ? 1 : 0,
      policy.dailyLimit,
      policy.userDailyLimit,
      sqlMicros(policy.monthlyBudgetMicrousd),
      sqlMicros(policy.inputRateMicrousdPerMillion),
      sqlMicros(policy.outputRateMicrousdPerMillion),
      hash,
      expectedRevision,
    )
    .run();
  if (inserted.meta.changes === 1) return 1;
  const changed = await store
    .prepare(
      `UPDATE "AiUsagePolicy" SET revision=revision+1,enabled=?1,daily_limit=?2,user_daily_limit=?3,monthly_budget_microusd=?4,input_rate=?5,output_rate=?6,priced_config_hash=?7,updated_at=?8
       WHERE family_id=?9 AND revision=?10 AND revision<2147483647`,
    )
    .bind(
      policy.enabled ? 1 : 0,
      policy.dailyLimit,
      policy.userDailyLimit,
      sqlMicros(policy.monthlyBudgetMicrousd),
      sqlMicros(policy.inputRateMicrousdPerMillion),
      sqlMicros(policy.outputRateMicrousdPerMillion),
      hash,
      Date.now(),
      familyId,
      expectedRevision,
    )
    .run();
  return changed.meta.changes === 1 ? expectedRevision + 1 : null;
}
