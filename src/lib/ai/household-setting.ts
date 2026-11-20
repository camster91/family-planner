/**
 * The household's "Smart helpers (AI)" switch (#144). Off by default: no row
 * means off. Parents change it; the cap is not parent-editable because it
 * bounds the app's own spend (default $2 a month). Both storage backends:
 * native D1 and the PostgreSQL compatibility path (raw SQL, so a database
 * without the migration reads as "off", never as an error that turns AI on).
 */
import type { PrismaClient } from "@prisma/client";
import type { D1Store } from "@/lib/cloudflare/database";
import { MANAGED_AI_JOBS } from "./registry";

export const DEFAULT_MONTHLY_CAP_MICROUSD = "2000000";

export interface HouseholdAiSetting {
  enabled: boolean;
  monthlyCapMicrousd: string;
  revision: number;
}

export const DEFAULT_HOUSEHOLD_AI_SETTING: HouseholdAiSetting = {
  enabled: false,
  monthlyCapMicrousd: DEFAULT_MONTHLY_CAP_MICROUSD,
  revision: 0,
};

export type AiSettingDb =
  D1Store | Pick<PrismaClient, "$queryRaw" | "$executeRaw" | "$transaction">;

export function isD1(db: unknown): db is D1Store {
  return Boolean(
    db &&
    typeof (db as D1Store).prepare === "function" &&
    typeof (db as D1Store).withSession === "function",
  );
}

export class HouseholdAiSettingError extends Error {
  constructor(
    readonly code:
      "AI_SETTING_UNAVAILABLE" | "AI_SETTING_CONFLICT" | "AI_SETTING_FORBIDDEN",
    readonly status: number,
  ) {
    super(code);
    this.name = "HouseholdAiSettingError";
  }
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

const jobList = MANAGED_AI_JOBS.map((job) => `'${job}'`).join(",");

/** Current switch. A missing table or row is "off". */
export async function readHouseholdAiSetting(
  db: AiSettingDb,
  familyId: string,
): Promise<HouseholdAiSetting> {
  try {
    if (isD1(db)) {
      const row = await db
        .withSession("first-primary")
        .prepare(
          `SELECT smart_helpers_enabled,monthly_cap_microusd,revision FROM "HouseholdAiSetting" WHERE family_id=?1`,
        )
        .bind(familyId)
        .first<{
          smart_helpers_enabled: number;
          monthly_cap_microusd: number;
          revision: number;
        }>();
      return row
        ? {
            enabled: row.smart_helpers_enabled === 1,
            monthlyCapMicrousd: String(row.monthly_cap_microusd),
            revision: row.revision,
          }
        : { ...DEFAULT_HOUSEHOLD_AI_SETTING };
    }
    const rows = await db.$queryRaw<
      Array<{ enabled: boolean; cap: string; revision: number }>
    >`SELECT "smart_helpers_enabled" AS enabled,"monthly_cap_microusd"::text AS cap,"revision"
      FROM "HouseholdAiSetting" WHERE "family_id"=${familyId}`;
    const row = rows[0];
    return row
      ? {
          enabled: row.enabled === true,
          monthlyCapMicrousd: row.cap,
          revision: row.revision,
        }
      : { ...DEFAULT_HOUSEHOLD_AI_SETTING };
  } catch {
    // Not migrated yet (or unreadable): treat as off.
    return { ...DEFAULT_HOUSEHOLD_AI_SETTING };
  }
}

/** This month's app-held AI spend for the household (settled estimate, else reservation). */
export async function readManagedAiMonthSpend(
  db: AiSettingDb,
  familyId: string,
  now = new Date(),
): Promise<string> {
  const month = monthStart(now);
  try {
    if (isD1(db)) {
      const row = await db
        .withSession("first-primary")
        .prepare(
          `SELECT CAST(COALESCE(SUM(COALESCE(estimated_microusd,reserved_microusd,0)),0) AS INTEGER) AS spent
           FROM "AiUsageRequest" WHERE family_id=?1 AND created_at>=?2 AND job IN (${jobList})`,
        )
        .bind(familyId, month.getTime())
        .first<{ spent: number }>();
      return String(row?.spent ?? 0);
    }
    const rows = await db.$queryRaw<Array<{ spent: string }>>`
      SELECT COALESCE(SUM(COALESCE("estimated_microusd","reserved_microusd",0)),0)::text AS spent
      FROM "AiUsageRequest" WHERE "family_id"=${familyId} AND "created_at">=${month} AND "job"='smart_add'`;
    return rows[0]?.spent ?? "0";
  } catch {
    return "0";
  }
}

/**
 * Parent-only write with lost-update protection. The SQL itself re-checks
 * that the actor is a current parent of this household (role, household and
 * session generation), so a demoted or moved account cannot flip the switch.
 */
export async function writeHouseholdAiSetting(
  db: AiSettingDb,
  actor: { userId: string; familyId: string; generation: number },
  enabled: boolean,
  expectedRevision: number,
): Promise<HouseholdAiSetting> {
  if (isD1(db)) {
    const session = db.withSession("first-primary");
    const parent = `EXISTS (SELECT 1 FROM "User" u WHERE u.id=?2 AND u.family_id=?1 AND u.role='parent' AND u.token_version=?3)`;
    let row: {
      smart_helpers_enabled: number;
      monthly_cap_microusd: number;
      revision: number;
    } | null;
    try {
      row =
        expectedRevision === 0
          ? await session
              .prepare(
                `INSERT INTO "HouseholdAiSetting"(family_id,smart_helpers_enabled,revision,updated_at)
                 SELECT ?1,?4,1,?5 WHERE ${parent}
                 ON CONFLICT(family_id) DO UPDATE SET smart_helpers_enabled=excluded.smart_helpers_enabled,
                   revision="HouseholdAiSetting".revision+1,updated_at=excluded.updated_at
                 WHERE "HouseholdAiSetting".revision=0
                 RETURNING smart_helpers_enabled,monthly_cap_microusd,revision`,
              )
              .bind(
                actor.familyId,
                actor.userId,
                actor.generation,
                enabled ? 1 : 0,
                Date.now(),
              )
              .first()
          : await session
              .prepare(
                `UPDATE "HouseholdAiSetting" SET smart_helpers_enabled=?4,revision=revision+1,updated_at=?5
                 WHERE family_id=?1 AND revision=?6 AND ${parent}
                 RETURNING smart_helpers_enabled,monthly_cap_microusd,revision`,
              )
              .bind(
                actor.familyId,
                actor.userId,
                actor.generation,
                enabled ? 1 : 0,
                Date.now(),
                expectedRevision,
              )
              .first();
    } catch {
      throw new HouseholdAiSettingError("AI_SETTING_UNAVAILABLE", 503);
    }
    if (!row) {
      const parentRow = await session
        .prepare(
          `SELECT 1 AS ok FROM "User" u WHERE u.id=?2 AND u.family_id=?1 AND u.role='parent' AND u.token_version=?3`,
        )
        .bind(actor.familyId, actor.userId, actor.generation)
        .first<{ ok: number }>();
      if (!parentRow)
        throw new HouseholdAiSettingError("AI_SETTING_FORBIDDEN", 403);
      throw new HouseholdAiSettingError("AI_SETTING_CONFLICT", 409);
    }
    return {
      enabled: row.smart_helpers_enabled === 1,
      monthlyCapMicrousd: String(row.monthly_cap_microusd),
      revision: row.revision,
    };
  }
  try {
    return await db.$transaction(async (tx) => {
      const users = await tx.$queryRaw<Array<{ ok: number }>>`
        SELECT 1 AS ok FROM "User" WHERE "id"=${actor.userId} AND "family_id"=${actor.familyId}
          AND "role"='parent' AND "token_version"=${actor.generation} FOR UPDATE`;
      if (!users[0])
        throw new HouseholdAiSettingError("AI_SETTING_FORBIDDEN", 403);
      const rows =
        expectedRevision === 0
          ? await tx.$queryRaw<
              Array<{ enabled: boolean; cap: string; revision: number }>
            >`
              INSERT INTO "HouseholdAiSetting"("family_id","smart_helpers_enabled","revision","updated_at")
              VALUES (${actor.familyId},${enabled},1,now())
              ON CONFLICT ("family_id") DO UPDATE SET "smart_helpers_enabled"=EXCLUDED."smart_helpers_enabled",
                "revision"="HouseholdAiSetting"."revision"+1,"updated_at"=now()
              WHERE "HouseholdAiSetting"."revision"=0
              RETURNING "smart_helpers_enabled" AS enabled,"monthly_cap_microusd"::text AS cap,"revision"`
          : await tx.$queryRaw<
              Array<{ enabled: boolean; cap: string; revision: number }>
            >`
              UPDATE "HouseholdAiSetting" SET "smart_helpers_enabled"=${enabled},"revision"="revision"+1,"updated_at"=now()
              WHERE "family_id"=${actor.familyId} AND "revision"=${expectedRevision} AND "revision"<2147483647
              RETURNING "smart_helpers_enabled" AS enabled,"monthly_cap_microusd"::text AS cap,"revision"`;
      const row = rows[0];
      if (!row) throw new HouseholdAiSettingError("AI_SETTING_CONFLICT", 409);
      return {
        enabled: row.enabled,
        monthlyCapMicrousd: row.cap,
        revision: row.revision,
      };
    });
  } catch (error) {
    if (error instanceof HouseholdAiSettingError) throw error;
    throw new HouseholdAiSettingError("AI_SETTING_UNAVAILABLE", 503);
  }
}
