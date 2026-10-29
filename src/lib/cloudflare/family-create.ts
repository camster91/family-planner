import type { D1Store } from './database'

export interface CreatedD1Family {
  [column: string]: unknown
  ambient_photo_ids: string
  id: string
  name: string
  invite_code: string
  subscription_tier: string
  features: string
  created_at: number
}

/**
 * The conditional INSERT and membership update share one D1 batch transaction.
 * A deleted/revoked/already-attached account inserts nothing. Concurrent create
 * batches serialize, so only one can see family_id IS NULL for this account.
 */
export async function createD1Family(db: D1Store, input: {
  userId: string; tokenVersion: number; familyId: string; name: string
  inviteCode: string; features: string; now: number
}): Promise<CreatedD1Family | 'gone' | 'already'> {
  const session = db.withSession('first-primary')
  const result = await session.batch<Record<string, unknown>>([
    session.prepare(`INSERT INTO "Family" (id, name, invite_code, features, created_at)
      SELECT ?1, ?2, ?3, ?4, ?5 FROM "User"
      WHERE id = ?6 AND token_version = ?7 AND family_id IS NULL`)
      .bind(input.familyId, input.name, input.inviteCode, input.features, input.now, input.userId, input.tokenVersion),
    session.prepare(`UPDATE "User" SET family_id = ?1, role = 'parent'
      WHERE id = ?2 AND token_version = ?3 AND family_id IS NULL
      AND EXISTS (SELECT 1 FROM "Family" WHERE id = ?1)`)
      .bind(input.familyId, input.userId, input.tokenVersion),
    session.prepare(`SELECT * FROM "Family" WHERE id = ?1 AND EXISTS
      (SELECT 1 FROM "User" WHERE id = ?2 AND family_id = ?1 AND token_version = ?3)`)
      .bind(input.familyId, input.userId, input.tokenVersion),
    session.prepare('SELECT family_id, token_version FROM "User" WHERE id = ?1').bind(input.userId),
  ])
  const family = result[2].results[0]
  if (family) return family as unknown as CreatedD1Family
  const user = result[3].results[0]
  return !user || user.token_version !== input.tokenVersion ? 'gone' : 'already'
}
