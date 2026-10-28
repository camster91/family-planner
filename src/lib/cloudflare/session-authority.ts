/** The small D1 surface needed for session authority; no ORM or Node driver. */
export interface SessionAuthorityDatabase {
  withSession(constraint: 'first-primary'): {
    prepare(sql: string): {
      bind(...values: string[]): {
        first<T>(): Promise<T | null>
      }
    }
  }
}

export interface SessionAuthority {
  token_version: number
  role: string
  family_id: string | null
}

/**
 * Always start on the primary. A replica-stale generation or role could admit
 * a revoked session. No result is cached across requests or households.
 */
export async function readD1SessionAuthority(
  db: SessionAuthorityDatabase,
  userId: string,
): Promise<SessionAuthority | null> {
  return db.withSession('first-primary')
    .prepare('SELECT token_version, role, family_id FROM "User" WHERE id = ?1')
    .bind(userId)
    .first<SessionAuthority>()
}

/** Resolve the request's binding, never a module-level snapshot of its env. */
export async function getD1SessionAuthority(userId: string): Promise<SessionAuthority | null> {
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  const { env } = getCloudflareContext()
  const db = (env as typeof env & { DB?: SessionAuthorityDatabase }).DB
  if (!db) throw new Error('D1 database binding DB is required')
  return readD1SessionAuthority(db, userId)
}
