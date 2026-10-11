/** #480 disposable rehearsal only. No runtime/auth/link/assignment activation. */
import { createHash } from 'node:crypto'
import type { Client, PoolClient } from 'pg'

export class MemberRehearsalError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export function memberIdForLegacyUser(familyId: string, userId: string): string {
  return `hm_${createHash('sha256').update(JSON.stringify([familyId, userId])).digest('hex').slice(0, 32)}`
}

export function parseMemberRehearsalArgs(args: string[]): { familyId: string; apply: boolean } {
  let familyId = ''
  let apply = false
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--family' && !familyId && args[i + 1]) familyId = args[++i]
    else if (args[i] === '--apply' && !apply) apply = true
    else throw new MemberRehearsalError('INVALID_ARGUMENTS')
  }
  if (!/^fx_[a-zA-Z0-9_-]+$/.test(familyId)) throw new MemberRehearsalError('FIXTURE_FAMILY_REQUIRED')
  return { familyId, apply }
}

type LegacyUser = {
  id: string; name: string; role: string; age: number | null
  avatar_url: string | null; board_color: string | null
}

/** Caller owns an idle client on a guarded disposable database. */
export async function rehearseHouseholdMembers(db: Client | PoolClient, familyId: string, apply = false) {
  if (!/^fx_[a-zA-Z0-9_-]+$/.test(familyId)) throw new MemberRehearsalError('FIXTURE_FAMILY_REQUIRED')
  await db.query('BEGIN')
  try {
    // Serialize competing rehearsals, then lock current household account rows.
    const family = await db.query('SELECT id FROM "Family" WHERE id = $1 FOR UPDATE', [familyId])
    if (family.rowCount !== 1) throw new MemberRehearsalError('FAMILY_NOT_FOUND')
    const users = await db.query<LegacyUser>(
      'SELECT id, name, role, age, avatar_url, board_color FROM "User" WHERE family_id = $1 ORDER BY id FOR UPDATE',
      [familyId]
    )
    if (users.rows.some((u) => !/^fx_[a-zA-Z0-9_-]+$/.test(u.id))) throw new MemberRehearsalError('NON_FIXTURE_ACCOUNT')
    if (users.rows.some((u) => !u.name.trim() || !['parent', 'teen', 'child'].includes(u.role) || (u.age !== null && u.age < 0))) {
      throw new MemberRehearsalError('INVALID_LEGACY_PROFILE')
    }
    const mappings = await db.query<{ user_id: string; member_id: string }>(
      'SELECT user_id, member_id FROM "HouseholdMemberLegacyMapping" WHERE family_id = $1', [familyId]
    )
    const existing = new Map(mappings.rows.map((m) => [m.user_id, m.member_id]))
    if (users.rows.some((u) => existing.has(u.id) && existing.get(u.id) !== memberIdForLegacyUser(familyId, u.id))) {
      throw new MemberRehearsalError('MAPPING_CONFLICT')
    }
    const planned = users.rows.filter((u) => !existing.has(u.id))
    // Never adopt an unrelated profile merely because its deterministic ID collides.
    for (const user of planned) {
      const occupied = await db.query('SELECT id FROM "HouseholdMember" WHERE id = $1', [memberIdForLegacyUser(familyId, user.id)])
      if (occupied.rowCount) throw new MemberRehearsalError('MEMBER_ID_CONFLICT')
    }
    if (apply) {
      for (const user of planned) {
        const memberId = memberIdForLegacyUser(familyId, user.id)
        await db.query(
          'INSERT INTO "HouseholdMember" (id, family_id, name, role, age, avatar_url, board_color) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [memberId, familyId, user.name, user.role, user.age, user.avatar_url, user.board_color]
        )
        await db.query('INSERT INTO "HouseholdMemberLegacyMapping" (user_id, member_id, family_id) VALUES ($1, $2, $3)', [user.id, memberId, familyId])
      }
    }
    await db.query(apply ? 'COMMIT' : 'ROLLBACK')
    return {
      usersScanned: users.rowCount ?? 0,
      existingMappings: existing.size,
      membersPlanned: planned.length,
      membersCreated: apply ? planned.length : 0,
      mappingsCreated: apply ? planned.length : 0,
      accountLinksCreated: 0,
    }
  } catch (error) {
    await db.query('ROLLBACK')
    throw error
  }
}
