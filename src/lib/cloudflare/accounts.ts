import type { User } from '@prisma/client'
import type { D1Store } from './database'

// Explicit server-only projections. Never include ignored/internal continuity
// columns by widening to SELECT *; HTTP callers apply their auth-field allowlist.
const ACCOUNT_COLUMNS = '"id", "email", "password", "name", "role", "age", "family_id", "avatar_url", "last_chore_date", "xp", "level", "streak", "best_streak", "email_verified", "reset_token", "reset_token_expires", "verify_token", "verify_token_expires", "token_version", "board_color", "display_preferences", "display_preferences_revision", "weekly_reset_progress", "weekly_reset_revision", "notify_chores", "notify_events", "notify_messages", "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end", "quiet_hours_time_zone", "morning_summary_enabled", "morning_summary_time_zone", "morning_summary_sent_on", "created_at"'
const PUBLIC_COLUMNS = 'id,email,name,role,age,family_id,avatar_url,email_verified,xp,level,streak,best_streak,last_chore_date,created_at'
const LOGIN_COLUMNS = `${PUBLIC_COLUMNS},password,token_version`
export type LoginUser = Pick<User, 'id' | 'email' | 'name' | 'role' | 'age' | 'family_id' | 'avatar_url' | 'email_verified' | 'xp' | 'level' | 'streak' | 'best_streak' | 'last_chore_date' | 'created_at' | 'password' | 'token_version'>

function decodeUser<T>(raw: Record<string, unknown> | null): T | null {
  if (!raw) return null
  const user = { ...raw }
  for (const field of ['email_verified', 'notify_chores', 'notify_events', 'notify_messages', 'quiet_hours_enabled', 'morning_summary_enabled']) {
    if (field in user) user[field] = Boolean(user[field])
  }
  for (const field of ['last_chore_date', 'reset_token_expires', 'verify_token_expires', 'created_at']) {
    if (typeof user[field] === 'number') user[field] = new Date(user[field])
  }
  for (const field of ['display_preferences', 'weekly_reset_progress']) {
    if (typeof user[field] === 'string') user[field] = JSON.parse(user[field] as string)
  }
  return user as T
}

export async function findD1Account(db: D1Store, email: string): Promise<User | null> {
  const row = await db.withSession('first-primary').prepare(`SELECT ${ACCOUNT_COLUMNS} FROM "User" WHERE email = ?1`).bind(email).first<Record<string, unknown>>()
  return decodeUser<User>(row)
}
export async function findD1LoginUser(db: D1Store, email: string): Promise<LoginUser | null> {
  const row = await db.withSession('first-primary').prepare(`SELECT ${LOGIN_COLUMNS} FROM "User" WHERE email = ?1`).bind(email).first<Record<string, unknown>>()
  return decodeUser<LoginUser>(row)
}

export async function findD1RegistrationInvite(db: D1Store, tokenHash: string) {
  const row = await db.withSession('first-primary').prepare(`SELECT i.id,i.family_id,i.role,i.email,i.expires_at,i.accepted_at,f.name AS family_name
    FROM "FamilyInvite" i JOIN "Family" f ON f.id = i.family_id WHERE i.token_hash = ?1`)
    .bind(tokenHash).first<{ id: string; family_id: string; role: string; email: string; expires_at: number; accepted_at: number | null; family_name: string }>()
  return row ? { ...row, expires_at: new Date(row.expires_at), accepted_at: row.accepted_at === null ? null : new Date(row.accepted_at), family: { name: row.family_name } } : null
}

export interface D1RegistrationInput {
  userId: string; email: string; passwordHash: string; name: string; now: number
  inviteTokenHash?: string
  auditId: string
  auditSummaries: { parent: string; teen: string; child: string }
}

/** Invite admission, account, single-use claim and audit commit together. */
export async function createD1Registration(db: D1Store, input: D1RegistrationInput): Promise<User | null> {
  const session = db.withSession('first-primary')
  if (!input.inviteTokenHash) {
    const row = await session.prepare(`INSERT INTO "User" (id,email,password,name,role,email_verified,created_at)
      VALUES (?1,?2,?3,?4,'parent',0,?5) RETURNING ${ACCOUNT_COLUMNS}`)
      .bind(input.userId, input.email, input.passwordHash, input.name, input.now).first<Record<string, unknown>>()
    return decodeUser<User>(row)
  }
  const result = await session.batch<Record<string, unknown>>([
    session.prepare(`INSERT INTO "User" (id,email,password,name,role,family_id,email_verified,created_at)
      SELECT ?1,?2,?3,?4,i.role,i.family_id,1,?5 FROM "FamilyInvite" i JOIN "Family" f ON f.id=i.family_id
      WHERE i.token_hash=?6 AND i.email=?2 AND i.accepted_at IS NULL AND i.expires_at>?5 AND i.role IN ('parent','teen','child')`)
      .bind(input.userId, input.email, input.passwordHash, input.name, input.now, input.inviteTokenHash),
    session.prepare(`UPDATE "FamilyInvite" SET accepted_at=?1 WHERE token_hash=?2
      AND accepted_at IS NULL AND EXISTS (SELECT 1 FROM "User" WHERE id=?3 AND family_id="FamilyInvite".family_id)`)
      .bind(input.now, input.inviteTokenHash, input.userId),
    session.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT ?1,family_id,id,'person','member.joined','member',id,
      CASE role WHEN 'parent' THEN ?2 WHEN 'teen' THEN ?3 ELSE ?4 END,?5 FROM "User" WHERE id=?6`)
      .bind(input.auditId, input.auditSummaries.parent, input.auditSummaries.teen, input.auditSummaries.child, input.now, input.userId),
    session.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM "User" WHERE id=?1`).bind(input.userId),
  ])
  return decodeUser<User>(result[3].results[0] ?? null)
}

export async function storeD1VerificationToken(db: D1Store, userId: string, tokenHash: string, expires: number): Promise<void> {
  const row = await db.prepare('UPDATE "User" SET verify_token=?1, verify_token_expires=?2 WHERE id=?3 RETURNING id')
    .bind(tokenHash, expires, userId).first<{ id: string }>()
  if (!row) throw new Error('Verification account unavailable')
}
export async function consumeD1VerificationToken(db: D1Store, tokenHash: string, now: number): Promise<boolean> {
  const row = await db.prepare('UPDATE "User" SET email_verified=1,verify_token_expires=NULL WHERE verify_token=?1 AND verify_token_expires>?2 RETURNING id')
    .bind(tokenHash, now).first<{ id: string }>()
  return row !== null
}
export async function isD1VerificationTokenUsed(db: D1Store, tokenHash: string): Promise<boolean> {
  return (await db.withSession('first-primary').prepare('SELECT id FROM "User" WHERE verify_token=?1 AND verify_token_expires IS NULL AND email_verified=1')
    .bind(tokenHash).first()) !== null
}

export type PublicUser = Omit<LoginUser, 'password' | 'token_version'>
export async function findD1PublicUser(db: D1Store, userId: string): Promise<PublicUser | null> {
  const row = await db.withSession('first-primary').prepare(`SELECT ${PUBLIC_COLUMNS} FROM "User" WHERE id=?1`)
    .bind(userId).first<Record<string, unknown>>()
  return decodeUser<PublicUser>(row)
}
export async function findD1PasswordUser(db: D1Store, userId: string): Promise<Pick<User, 'id' | 'password'> | null> {
  return db.withSession('first-primary').prepare('SELECT id,password FROM "User" WHERE id=?1')
    .bind(userId).first<Pick<User, 'id' | 'password'>>()
}
export async function findD1AuthUser(db: D1Store, userId: string, version: number) {
  const row = await db.withSession('first-primary').prepare('SELECT id,family_id,role,name,last_chore_date FROM "User" WHERE id=?1 AND token_version=?2')
    .bind(userId, version).first<Record<string, unknown>>()
  return decodeUser<Pick<User, 'id' | 'family_id' | 'role' | 'name' | 'last_chore_date'>>(row)
}
export async function updateD1Profile(db: D1Store, userId: string, version: number, data: { name?: string; age?: number | null }): Promise<PublicUser | null> {
  const row = await db.prepare(`UPDATE "User" SET name=CASE WHEN ?1=1 THEN ?2 ELSE name END,
    age=CASE WHEN ?3=1 THEN ?4 ELSE age END WHERE id=?5 AND token_version=?6 RETURNING ${PUBLIC_COLUMNS}`)
    .bind(data.name !== undefined ? 1 : 0, data.name ?? null, data.age !== undefined ? 1 : 0,
      data.age ?? null, userId, version).first<Record<string, unknown>>()
  return decodeUser<PublicUser>(row)
}
