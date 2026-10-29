import {
  DOMAIN_EVENT_TYPES,
  LEGACY_ANALYTICS_RETENTION_MS,
  LEGACY_ANALYTICS_TYPE_PREFIX,
} from "@/lib/legacy-analytics";
import { getD1Database, type D1Store } from "./database";

/** Retention-only compatibility path. Never admit browser paths or metadata. */
export async function pruneD1LegacyAnalytics(
  actor: { userId: string; familyId: string; generation: number },
  now = new Date(),
  database?: D1Store,
): Promise<number> {
  try {
    const db = (database ?? (await getD1Database())).withSession(
      "first-primary",
    );
    const exclusions = DOMAIN_EVENT_TYPES.map(
      (_, index) => `?${index + 4}`,
    ).join(",");
    const userIndex = DOMAIN_EVENT_TYPES.length + 4;
    const result = await db.batch<{ affected: number }>([
      db
        .prepare(
          `DELETE FROM "Activity" WHERE family_id=?1 AND created_at<?2
        AND substr(type,1,${LEGACY_ANALYTICS_TYPE_PREFIX.length})=?3
        AND type NOT IN (${exclusions}) AND EXISTS (
          SELECT 1 FROM "User" WHERE id=?${userIndex} AND family_id=?1 AND token_version=?${userIndex + 1})`,
        )
        .bind(
          actor.familyId,
          now.getTime() - LEGACY_ANALYTICS_RETENTION_MS,
          LEGACY_ANALYTICS_TYPE_PREFIX,
          ...DOMAIN_EVENT_TYPES,
          actor.userId,
          actor.generation,
        ),
      db.prepare("SELECT changes() AS affected"),
    ]);
    return result[1].results[0]?.affected ?? 0;
  } catch {
    // Housekeeping failures preserve the existing successful no-op response.
    console.warn("Legacy analytics prune failed");
    return 0;
  }
}
