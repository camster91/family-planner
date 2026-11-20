/**
 * Budget metering for app-held ("managed") AI (#144). Reuses the existing,
 * content-free AiUsageRequest ledger and AiUsagePolicy limits, but the price
 * comes from the server (MODEL_RATES), not a parent-entered rate for a
 * family-supplied key, and the monthly cap comes from HouseholdAiSetting.
 *
 * Reserve before the call (conservative: request bytes as tokens plus fixed
 * overhead, and the full output-token limit), settle the provider-reported
 * usage after. A reservation that never settles keeps counting against the
 * cap; nothing is refunded or retried automatically. No prompts, replies,
 * names or provider bodies are stored.
 */
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  estimateAiMicrousd,
  type AiUsagePolicy,
} from "@/lib/ai-usage-contract";
import { AiUsageError } from "@/lib/ai-usage-errors";
import { isAiUsageReady } from "@/lib/ai-usage-gates";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { aiProviderPaused } from "./flags";
import { isD1, type AiSettingDb } from "./household-setting";
import { MANAGED_AI_JOBS, MODEL_RATES, type ManagedAiJob } from "./registry";
import type { AiUsageReport } from "./provider";

/** Fixed allowance for the system prompt and framing, in tokens. */
export const RESERVATION_OVERHEAD_TOKENS = 2048;

export interface ManagedAiActor {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
}

export interface ManagedReservation {
  id: string;
  inputRate: string;
  outputRate: string;
  reservedMicrousd: string;
  startedAt: number;
}

export type ManagedSettle = {
  status: number;
  providerStatus: "unconfirmed" | "response" | "timeout" | "error";
  usage: AiUsageReport | null;
};

function ratesFor(model: string) {
  const rates = MODEL_RATES[model];
  if (!rates) throw new AiUsageError("AI_PRICE_UNAVAILABLE");
  return rates;
}

function pricing(model: string): AiUsagePolicy {
  const rates = ratesFor(model);
  return {
    enabled: true,
    dailyLimit: 120,
    userDailyLimit: 40,
    monthlyBudgetMicrousd: null,
    inputRateMicrousdPerMillion: rates.input,
    outputRateMicrousdPerMillion: rates.output,
  };
}

/** Conservative pre-call estimate in micro-USD (rounded up). */
export function reservationMicrousd(
  model: string,
  inputBytes: number,
  maxOutputTokens: number,
): string {
  if (
    !Number.isSafeInteger(inputBytes) ||
    inputBytes < 0 ||
    inputBytes > 1_000_000 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 8192
  )
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  return estimateAiMicrousd(
    inputBytes + RESERVATION_OVERHEAD_TOKENS,
    maxOutputTokens,
    pricing(model),
  )!;
}

/** Settled estimate from reported usage, or null when either count is unknown. */
export function settledMicrousd(
  model: string,
  usage: AiUsageReport | null,
): string | null {
  if (!usage || usage.inputTokens === null || usage.outputTokens === null)
    return null;
  return estimateAiMicrousd(
    usage.inputTokens,
    usage.outputTokens,
    pricing(model),
  );
}

const jobList = MANAGED_AI_JOBS.map((job) => `'${job}'`).join(",");

function windows(now: Date) {
  const day = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  return {
    day,
    month: Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    retention: day - 90 * 86_400_000,
  };
}

/**
 * Reserve one call. Refuses (never dispatches) when: metering or the provider
 * is paused, the household switch is off, the caller is no longer a current
 * parent/teen of the household, a daily request limit is reached, or the
 * reservation would take this month's app-held spend over the household cap.
 */
export async function reserveManagedAi(
  db: AiSettingDb,
  actor: ManagedAiActor,
  job: ManagedAiJob,
  model: string,
  input: { inputBytes: number; maxOutputTokens: number },
  now = new Date(),
): Promise<ManagedReservation> {
  if (!isAiUsageReady() || aiProviderPaused())
    throw new AiUsageError("AI_PAUSED");
  const rates = ratesFor(model);
  const reserve = reservationMicrousd(
    model,
    input.inputBytes,
    input.maxOutputTokens,
  );
  const w = windows(now);
  const id = randomUUID();
  if (isD1(db)) {
    const store = db.withSession("first-primary");
    let inserted: { id: string } | null;
    try {
      inserted = await store
        .prepare(
          `WITH policy AS (
            SELECT enabled,daily_limit,user_daily_limit FROM "AiUsagePolicy" WHERE family_id=?1
            UNION ALL SELECT 1,120,40 WHERE NOT EXISTS (SELECT 1 FROM "AiUsagePolicy" WHERE family_id=?1)
          ), setting AS (
            SELECT monthly_cap_microusd AS cap FROM "HouseholdAiSetting" WHERE family_id=?1 AND smart_helpers_enabled=1
          )
          INSERT INTO "AiUsageRequest"(id,family_id,user_id,job,created_at,outcome,provider_status,input_rate,output_rate,reserved_microusd)
          SELECT ?2,?1,?3,?4,?5,'pending','unconfirmed',?6,?7,?8
          FROM policy, setting
          WHERE policy.enabled=1
            AND EXISTS (SELECT 1 FROM "User" u WHERE u.id=?3 AND u.family_id=?1 AND u.role=?9
              AND u.role IN ('parent','teen') AND u.token_version=?10)
            AND (SELECT COUNT(*) FROM "AiUsageRequest" r WHERE r.family_id=?1 AND r.created_at>=?11) < policy.daily_limit
            AND (SELECT COUNT(*) FROM "AiUsageRequest" r WHERE r.user_id=?3 AND r.created_at>=?11) < policy.user_daily_limit
            AND CAST(COALESCE((SELECT SUM(COALESCE(r.estimated_microusd,r.reserved_microusd,0)) FROM "AiUsageRequest" r
              WHERE r.family_id=?1 AND r.created_at>=?12 AND r.job IN (${jobList})),0) AS INTEGER) + ?8 <= setting.cap
          RETURNING id`,
        )
        .bind(
          actor.familyId,
          id,
          actor.userId,
          job,
          now.getTime(),
          Number(rates.input),
          Number(rates.output),
          Number(reserve),
          actor.role,
          actor.generation,
          w.day,
          w.month,
        )
        .first<{ id: string }>();
    } catch {
      throw new AiUsageError("AI_USAGE_UNAVAILABLE");
    }
    if (!inserted) throw await explainRefusal(db, actor);
    await store
      .prepare(
        `DELETE FROM "AiUsageRequest" WHERE id IN (SELECT id FROM "AiUsageRequest"
          WHERE family_id=?1 AND created_at<?2 ORDER BY created_at,id LIMIT 500)`,
      )
      .bind(actor.familyId, w.retention)
      .run()
      .catch(() => undefined);
    return {
      id,
      inputRate: rates.input,
      outputRate: rates.output,
      reservedMicrousd: reserve,
      startedAt: Date.now(),
    };
  }
  const pg = db as Pick<PrismaClient, "$transaction">;
  try {
    await pg.$transaction(async (tx) => {
      await lockUser(tx, actor.userId);
      await lockHousehold(tx, actor.familyId);
      const users = await tx.$queryRaw<Array<{ ok: number }>>`
        SELECT 1 AS ok FROM "User" WHERE "id"=${actor.userId} AND "family_id"=${actor.familyId}
          AND "role"=${actor.role} AND "role" IN ('parent','teen') AND "token_version"=${actor.generation}`;
      if (!users[0]) throw new AiUsageError("AI_SOURCE_CHANGED", 409);
      const settings = await tx.$queryRaw<Array<{ cap: string }>>`
        SELECT "monthly_cap_microusd"::text AS cap FROM "HouseholdAiSetting"
        WHERE "family_id"=${actor.familyId} AND "smart_helpers_enabled"=true`;
      if (!settings[0]) throw new AiUsageError("AI_PAUSED");
      const policies = await tx.$queryRaw<
        Array<{ enabled: boolean; daily: number; user_daily: number }>
      >`
        SELECT "enabled","daily_limit" AS daily,"user_daily_limit" AS user_daily FROM "AiUsagePolicy" WHERE "family_id"=${actor.familyId}`;
      const policy = policies[0] ?? {
        enabled: true,
        daily: 120,
        user_daily: 40,
      };
      if (!policy.enabled) throw new AiUsageError("AI_PAUSED");
      const dayStart = new Date(w.day);
      const monthStart = new Date(w.month);
      const counts = await tx.$queryRaw<
        Array<{ family_day: number; user_day: number; month_cost: string }>
      >`
        SELECT COUNT(*) FILTER (WHERE "family_id"=${actor.familyId} AND "created_at">=${dayStart})::int AS family_day,
          COUNT(*) FILTER (WHERE "user_id"=${actor.userId} AND "created_at">=${dayStart})::int AS user_day,
          COALESCE(SUM(COALESCE("estimated_microusd","reserved_microusd",0)) FILTER (
            WHERE "family_id"=${actor.familyId} AND "job"='smart_add'),0)::text AS month_cost
        FROM "AiUsageRequest" WHERE "created_at">=${monthStart} AND ("family_id"=${actor.familyId} OR "user_id"=${actor.userId})`;
      const c = counts[0];
      if (
        !c ||
        c.family_day >= policy.daily ||
        c.user_day >= policy.user_daily ||
        BigInt(c.month_cost) + BigInt(reserve) > BigInt(settings[0].cap)
      )
        throw new AiUsageError("AI_QUOTA_REACHED", 429);
      await tx.$executeRaw`INSERT INTO "AiUsageRequest" ("id","family_id","user_id","job","created_at","input_rate","output_rate","reserved_microusd")
        VALUES (${id},${actor.familyId},${actor.userId},${job},${now},${rates.input}::bigint,${rates.output}::bigint,${reserve}::bigint)`;
      await tx.$executeRaw`DELETE FROM "AiUsageRequest" WHERE "id" IN (SELECT "id" FROM "AiUsageRequest" WHERE "family_id"=${actor.familyId} AND "created_at"<${new Date(w.retention)} ORDER BY "created_at","id" LIMIT 500)`;
    });
  } catch (error) {
    if (error instanceof AiUsageError) throw error;
    throw new AiUsageError("AI_USAGE_UNAVAILABLE");
  }
  return {
    id,
    inputRate: rates.input,
    outputRate: rates.output,
    reservedMicrousd: reserve,
    startedAt: Date.now(),
  };
}

async function explainRefusal(
  db: AiSettingDb,
  actor: ManagedAiActor,
): Promise<AiUsageError> {
  if (!isD1(db)) return new AiUsageError("AI_QUOTA_REACHED", 429);
  try {
    const row = await db
      .withSession("first-primary")
      .prepare(
        `SELECT u.family_id,u.role,u.token_version,
           (SELECT smart_helpers_enabled FROM "HouseholdAiSetting" WHERE family_id=?2) AS switch_on,
           (SELECT enabled FROM "AiUsagePolicy" WHERE family_id=?2) AS policy_on
         FROM "User" u WHERE u.id=?1`,
      )
      .bind(actor.userId, actor.familyId)
      .first<{
        family_id: string | null;
        role: string;
        token_version: number;
        switch_on: number | null;
        policy_on: number | null;
      }>();
    if (
      !row ||
      row.family_id !== actor.familyId ||
      row.role !== actor.role ||
      !["parent", "teen"].includes(row.role) ||
      row.token_version !== actor.generation
    )
      return new AiUsageError("AI_SOURCE_CHANGED", 409);
    if (row.switch_on !== 1 || row.policy_on === 0)
      return new AiUsageError("AI_PAUSED");
  } catch {
    return new AiUsageError("AI_USAGE_UNAVAILABLE");
  }
  return new AiUsageError("AI_QUOTA_REACHED", 429);
}

/** Record the outcome and provider-reported usage. Never throws; never re-dispatches. */
export async function settleManagedAi(
  db: AiSettingDb,
  actor: Pick<ManagedAiActor, "familyId">,
  model: string,
  reservation: ManagedReservation,
  result: ManagedSettle,
  now = new Date(),
): Promise<void> {
  const elapsed = now.getTime() - reservation.startedAt;
  const latency =
    Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 300_000
      ? Math.floor(elapsed)
      : null;
  const outcome =
    result.status >= 200 && result.status < 300
      ? "accepted"
      : result.status >= 400 && result.status < 500
        ? "refused"
        : "failed";
  const input = result.usage?.inputTokens ?? null;
  const output = result.usage?.outputTokens ?? null;
  const cost = settledMicrousd(model, result.usage);
  try {
    if (isD1(db)) {
      await db
        .withSession("first-primary")
        .prepare(
          `UPDATE "AiUsageRequest" SET finished_at=?1,outcome=?2,provider_status=?3,latency_ms=?4,input_tokens=?5,output_tokens=?6,estimated_microusd=?7
           WHERE id=?8 AND family_id=?9 AND outcome='pending'`,
        )
        .bind(
          now.getTime(),
          outcome,
          result.providerStatus,
          latency,
          input,
          output,
          cost === null ? null : Number(cost),
          reservation.id,
          actor.familyId,
        )
        .run();
      return;
    }
    await (db as Pick<PrismaClient, "$executeRaw">)
      .$executeRaw`UPDATE "AiUsageRequest" SET "finished_at"=${now},"outcome"=${outcome},"provider_status"=${result.providerStatus},"latency_ms"=${latency},"input_tokens"=${input},"output_tokens"=${output},"estimated_microusd"=${cost}::bigint
      WHERE "id"=${reservation.id} AND "family_id"=${actor.familyId} AND "outcome"='pending'`;
  } catch {
    // Content-free; the reservation keeps counting against the cap.
    console.warn("ai.managed_usage_settle_unavailable");
  }
}
