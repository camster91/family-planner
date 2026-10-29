import type { D1Store } from './database'

/** Presence guard only; it never rotates a device session or grants person authority. */
export async function hasD1DeviceCredential(db: D1Store, hashes: { access?: string; refresh?: string }, now: number, refreshGraceMs: number): Promise<boolean> {
  const session = db.withSession('first-primary')
  if (hashes.access) {
    const row = await session.prepare(`SELECT s.id FROM "DeviceSession" s JOIN "HouseholdDevice" d ON d.id=s.device_id AND d.family_id=s.family_id
      WHERE s.access_token_hash=?1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.rotated_at IS NULL AND s.access_expires_at>?2`)
      .bind(hashes.access, now).first()
    if (row) return true
  }
  if (hashes.refresh) {
    const row = await session.prepare(`SELECT s.id FROM "DeviceSession" s JOIN "HouseholdDevice" d ON d.id=s.device_id AND d.family_id=s.family_id
      WHERE s.refresh_token_hash=?1 AND s.revoked_at IS NULL AND d.revoked_at IS NULL AND s.refresh_expires_at>?2
      AND (s.rotated_at IS NULL OR ?2-s.rotated_at<?3)`)
      .bind(hashes.refresh, now, refreshGraceMs).first()
    if (row) return true
  }
  return false
}
