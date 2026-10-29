import { createHash, randomUUID } from 'node:crypto'
import { getD1Database, type D1Store } from './database'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { householdProfileCommand, HouseholdProfileError, publicProfile, type PublicHouseholdProfile } from '@/lib/household-profile-management'
import { isProfileAgeAllowed } from '@/lib/member-subject-contract'
import { isValidIdempotencyKey, IDEMPOTENCY_TTL_MS } from '@/lib/idempotency-key'
import { hashIdempotentRequest } from '@/lib/idempotency-hash'
import { rewriteRoutineFutureSubject } from '@/lib/routine-subject-lifecycle'
import { routineScheduleConfig } from '@/lib/routine-schedule'

type Actor = { userId: string; familyId: string; tokenVersion: number }
type Session = Pick<D1Store, 'prepare' | 'batch'>
type Authority = { role: string; family_id: string | null; token_version: number; family_exists: string | null }
type ProfileRow = { id: string; family_id: string; name: string; role: string; age: number | null; archived_at: number | null; revision: number; erasure_user_id: string | null; mapped: number; linked: number }
type Receipt = { id: string; family_id: string; action: string; request_hash: string; expires_at: number; response_status: number | null; response_body: string | null }
type Root = { id: string; routine_series_config: string }
type Stack = { id: string; label: string; version: number; fingerprint: string; schedule_config: string | null }
const AUTHORITY = `SELECT u.role,u.family_id,u.token_version,f.id AS family_exists FROM "User" u LEFT JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1`
const PROFILE = `SELECT m.id,m.family_id,m.name,m.role,m.age,m.archived_at,m.revision,m.erasure_user_id,
  EXISTS(SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=m.id) AS mapped,
  EXISTS(SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=m.id) AS linked FROM "HouseholdMember" m`
const ROOTS = `SELECT id,routine_series_config FROM "Chore" WHERE family_id=?1 AND recurrence_id=id AND routine_series_config IS NOT NULL
  AND json_extract(routine_series_config,'$.content.subject.member_id')=?2 ORDER BY id`
const STACKS = `SELECT id,label,version,fingerprint,schedule_config FROM "RoutineStack" WHERE family_id=?1 AND id IN (SELECT value FROM json_each(?2)) ORDER BY id`
function authority(row: Authority | null, actor: Actor) {
  if (!row || row.token_version !== actor.tokenVersion) throw new HouseholdProfileError('UNAUTHORIZED')
  if (row.role !== 'parent' || row.family_id !== actor.familyId) throw new HouseholdProfileError('FORBIDDEN')
  if (!row.family_exists) throw new HouseholdProfileError('NOT_FOUND')
}
function dto(row: Pick<ProfileRow, 'id' | 'family_id' | 'name' | 'role' | 'age' | 'archived_at' | 'revision'>): PublicHouseholdProfile {
  return publicProfile.parse({ id: row.id, family_id: row.family_id, name: row.name, role: row.role, age: row.age,
    archived_at: row.archived_at === null ? null : new Date(row.archived_at).toISOString(), revision: row.revision })
}
function actorCheck(db: Session, actor: Actor) {
  return d1WriteCheck(db, `EXISTS(SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1 AND u.family_id=?2 AND u.role='parent' AND u.token_version=?3)`, [actor.userId, actor.familyId, actor.tokenVersion])
}
/** Shared native D1 batch: profile, future routine invalidation and receipt. */
export async function manageD1HouseholdProfile(actor: Actor, key: string, input: unknown, now = new Date(), database?: D1Store) {
  const parsed = householdProfileCommand.safeParse(input)
  if (!parsed.success || !isValidIdempotencyKey(key)) throw new HouseholdProfileError('INVALID')
  const command = parsed.data
  if (command.action === 'create' && !isProfileAgeAllowed(command.role, command.age)) throw new HouseholdProfileError('INVALID')
  if (command.action === 'edit' && command.role !== undefined && !isProfileAgeAllowed(command.role, command.age)) throw new HouseholdProfileError('INVALID')
  const scope = `user:${actor.userId}`, action = `household-profile.${command.action}`
  const requestHash = hashIdempotentRequest(action, command)
  const db = (database ?? await getD1Database()).withSession('first-primary')
  for (let attempt = 0; attempt < 16; attempt++) {
    authority(await db.prepare(AUTHORITY).bind(actor.userId).first<Authority>(), actor)
    const prior = await db.prepare('SELECT id,family_id,action,request_hash,expires_at,response_status,response_body FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2').bind(scope, key).first<Receipt>()
    if (prior) {
      if (prior.family_id !== actor.familyId || prior.action !== action || prior.request_hash !== requestHash) throw new HouseholdProfileError('KEY_REUSED')
      if (prior.expires_at > now.getTime()) {
        if (prior.response_status !== 200 || prior.response_body === null) throw new HouseholdProfileError('CONFLICT')
        const saved = publicProfile.safeParse(JSON.parse(prior.response_body))
        if (!saved.success || saved.data.family_id !== actor.familyId) throw new HouseholdProfileError('CONFLICT')
        // Never renew stale authority merely because a matching receipt exists.
        authority(await db.prepare(AUTHORITY).bind(actor.userId).first<Authority>(), actor)
        return { profile: saved.data, replayed: true }
      }
    }
    const id = command.action === 'create' ? `hm_${createHash('sha256').update(JSON.stringify([actor.familyId, actor.userId, key])).digest('hex')}` : command.id
    const member = await db.prepare(PROFILE + ' WHERE m.id=?1 AND m.family_id=?2').bind(id, actor.familyId).first<ProfileRow>()
    let next: PublicHouseholdProfile
    let roots: Root[] = [], stacks: Stack[] = []
    let stackIds: string[] = []
    const rewrites: Array<{ id: string; config: string }> = []
    const stackChanges: Array<{ id: string; version: number; fingerprint: string }> = []
    if (command.action === 'create') {
      if (await db.prepare('SELECT id FROM "HouseholdMember" WHERE id=?1').bind(id).first()) throw new HouseholdProfileError('CONFLICT')
      next = publicProfile.parse({ id, family_id: actor.familyId, name: command.name, role: command.role, age: command.age ?? null, archived_at: null, revision: 0 })
    } else {
      if (!member) throw new HouseholdProfileError('NOT_FOUND')
      if (!['parent', 'teen', 'child'].includes(member.role) || member.mapped || member.linked || member.erasure_user_id || member.archived_at !== null || member.revision !== command.revision) throw new HouseholdProfileError('CONFLICT')
      if (command.action === 'edit' && !isProfileAgeAllowed(command.role ?? member.role as 'parent' | 'teen' | 'child', command.age !== undefined ? command.age : member.age)) throw new HouseholdProfileError('INVALID')
      next = dto({ ...member, ...(command.action === 'archive' ? { archived_at: now.getTime() } : { name: command.name, role: command.role ?? member.role, age: command.age !== undefined ? command.age : member.age }), revision: member.revision + 1 })
      roots = (await db.prepare(ROOTS).bind(actor.familyId, id).all<Root>()).results
      const touchedStacks = new Set<string>()
      for (const root of roots) {
        const rewritten = rewriteRoutineFutureSubject(JSON.parse(root.routine_series_config), { kind: 'invalidate', memberIds: [id] })
        if (!rewritten) continue
        rewrites.push({ id: root.id, config: JSON.stringify(rewritten.value) })
        if (rewritten.stackId) touchedStacks.add(rewritten.stackId)
      }
      stackIds = [...touchedStacks].sort()
      stacks = (await db.prepare(STACKS).bind(actor.familyId, JSON.stringify(stackIds)).all<Stack>()).results
      for (const stack of stacks) {
        const raw = stack.schedule_config === null ? null : JSON.parse(stack.schedule_config)
        const config = routineScheduleConfig.safeParse(raw), version = Math.min(2147483647, stack.version + 1)
        stackChanges.push({ id: stack.id, version, fingerprint: createHash('sha256').update(JSON.stringify({ label: stack.label, version, config: config.success ? config.data : raw })).digest('hex') })
      }
    }
    const statements = [actorCheck(db, actor)]
    if (prior) {
      statements.push(d1WriteCheck(db, `EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE id=?1 AND scope=?2 AND key=?3 AND family_id=?4 AND action=?5 AND request_hash=?6 AND expires_at<=?7)`, [prior.id, scope, key, actor.familyId, action, requestHash, now.getTime()]))
      statements.push(db.prepare('DELETE FROM "IdempotencyRecord" WHERE id=?1').bind(prior.id))
    }
    statements.push(d1WriteCheck(db, 'NOT EXISTS(SELECT 1 FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2)', [scope, key]))
    if (command.action === 'create') {
      statements.push(d1WriteCheck(db, 'NOT EXISTS(SELECT 1 FROM "HouseholdMember" WHERE id=?1)', [id]))
      statements.push(db.prepare('INSERT INTO "HouseholdMember" (id,family_id,name,role,age,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)').bind(id, actor.familyId, next.name, next.role, next.age, now.getTime()))
    } else {
      statements.push(d1WriteCheck(db, `EXISTS(SELECT 1 FROM "HouseholdMember" m WHERE m.id=?1 AND m.family_id=?2 AND m.revision=?3 AND m.name=?4 AND m.role=?5 AND m.age IS ?6 AND m.archived_at IS NULL AND m.erasure_user_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=m.id) AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=m.id))`, [id, actor.familyId, member!.revision, member!.name, member!.role, member!.age]))
      statements.push(d1WriteCheck(db, `(SELECT json_group_array(json_object('id',id,'config',routine_series_config)) FROM (${ROOTS}))=?3`, [actor.familyId, id, JSON.stringify(roots.map(row => ({ id: row.id, config: row.routine_series_config })))]))
      // Check all referenced IDs, including unavailable stacks: one that
      // became available must be re-read and invalidated in the same save.
      statements.push(d1WriteCheck(db, `(SELECT json_group_array(json_object('id',id,'label',label,'version',version,'fingerprint',fingerprint,'config',schedule_config)) FROM (${STACKS}))=?3`, [actor.familyId, JSON.stringify(stackIds), JSON.stringify(stacks.map(row => ({ id: row.id, label: row.label, version: row.version, fingerprint: row.fingerprint, config: row.schedule_config })))]))
      statements.push(db.prepare('UPDATE "HouseholdMember" SET name=?1,role=?2,age=?3,archived_at=?4,revision=?5,updated_at=?6 WHERE id=?7 AND family_id=?8').bind(next.name, next.role, next.age, next.archived_at === null ? null : now.getTime(), next.revision, now.getTime(), id, actor.familyId))
      if (rewrites.length) {
        statements.push(db.prepare(`UPDATE "Chore" SET routine_series_config=(SELECT json_extract(value,'$.config') FROM json_each(?1) WHERE json_extract(value,'$.id')="Chore".id) WHERE family_id=?2 AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?1))`).bind(JSON.stringify(rewrites), actor.familyId))
        statements.push(d1WriteCheck(db, 'changes()=?1', [rewrites.length]))
      }
      if (stackChanges.length) {
        statements.push(db.prepare(`UPDATE "RoutineStack" SET version=(SELECT json_extract(value,'$.version') FROM json_each(?1) WHERE json_extract(value,'$.id')="RoutineStack".id),
          fingerprint=(SELECT json_extract(value,'$.fingerprint') FROM json_each(?1) WHERE json_extract(value,'$.id')="RoutineStack".id),updated_at=?3
          WHERE family_id=?2 AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?1))`).bind(JSON.stringify(stackChanges), actor.familyId, now.getTime()))
        statements.push(d1WriteCheck(db, 'changes()=?1', [stackChanges.length]))
      }
    }
    statements.push(db.prepare(`INSERT INTO "IdempotencyRecord" (id,scope,key,family_id,user_id,action,request_hash,response_status,response_body,created_at,expires_at) VALUES (?1,?2,?3,?4,?5,?6,?7,200,?8,?9,?10)`).bind(randomUUID(), scope, key, actor.familyId, actor.userId, action, requestHash, JSON.stringify(next), now.getTime(), now.getTime() + IDEMPOTENCY_TTL_MS))
    try {
      await db.batch(statements)
      return { profile: next, replayed: false }
    } catch (error) {
      if (!isD1WriteConflict(error)) throw error
    }
  }
  throw new HouseholdProfileError('CONFLICT')
}
export async function listD1HouseholdProfiles(actor: Actor, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const result = await db.batch<Authority | ProfileRow>([
    db.prepare(AUTHORITY).bind(actor.userId),
    db.prepare(PROFILE + ` WHERE m.family_id=?1 AND m.erasure_user_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id=m.id)
      AND NOT EXISTS(SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id=m.id)
      AND EXISTS(SELECT 1 FROM "User" WHERE id=?2 AND family_id=?1 AND role='parent' AND token_version=?3)
      ORDER BY m.archived_at ASC,m.name ASC,m.id ASC`).bind(actor.familyId, actor.userId, actor.tokenVersion),
  ])
  authority((result[0].results[0] as Authority | undefined) ?? null, actor)
  return (result[1].results as ProfileRow[]).map(dto)
}
