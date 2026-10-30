import type { D1Store } from "@/lib/cloudflare/database";
import type { CallActor } from "./protocol";
/** Recheck canonical authority, never a room-local login or cached role. */
export async function callActorAllowed(
  db: D1Store,
  actor: CallActor,
  now = Date.now(),
): Promise<boolean> {
  const sql =
    actor.kind === "person"
      ? `SELECT u.id FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1 AND u.family_id=?2 AND u.token_version=?3 AND u.role IN ('parent','teen','child') AND json_extract(f.features,'$.calling')=1`
      : `SELECT d.id FROM "HouseholdDevice" d JOIN "DeviceSession" s ON s.device_id=d.id AND s.family_id=d.family_id JOIN "Family" f ON f.id=d.family_id WHERE d.id=?1 AND d.family_id=?2 AND s.id=?3 AND d.revoked_at IS NULL AND s.revoked_at IS NULL AND s.rotated_at IS NULL AND s.access_expires_at>?4 AND json_extract(f.features,'$.calling')=1`;
  const values =
    actor.kind === "person"
      ? [actor.userId, actor.familyId, actor.generation]
      : [actor.deviceId, actor.familyId, actor.sessionId, now];
  return !!(await db
    .withSession("first-primary")
    .prepare(sql)
    .bind(...values)
    .first());
}
