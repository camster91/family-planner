/** Native D1 birthdays, anniversaries and custom family dates.
 *
 * Dates follow the existing D9 ownership rules: every member may create one,
 * children/teens may edit only dates they created, and only parents may
 * delete. Keyed writes use the shared person receipt coordinator so an
 * offline retry cannot create a second date.
 */
import { randomUUID } from 'node:crypto'
import type { EffectResult } from '@/lib/idempotency'
import type { AssistantProofActor } from '@/lib/assistant-source-proof'
import { canEditOwnedRecord } from '@/lib/role-capabilities'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { nextAnnualOccurrence, toDateOnlyUTC } from '@/lib/dates'
import { executeD1PersonEffect, type NativePersonResult } from './person-effect'
import { getD1Database, type D1Store } from './database'
import { withD1ReadClient, type D1ReadClient } from './read-client'
import { d1WriteCheck, isD1WriteConflict } from './write-check'

export type D1AnniversaryActor = AssistantProofActor
type NativeResult = EffectResult & { replayed?: boolean }

const failure = (status: number, error: string): EffectResult => ({ status, body: { error } })

function jsonDate(value: unknown): Date | null {
  if (value == null) return null
  if (value instanceof Date) return value
  const date = new Date(typeof value === 'number' ? value : String(value))
  return Number.isFinite(date.getTime()) ? date : null
}

function familyFeatures(value: unknown) {
  if (typeof value !== 'string') return normalizeFeatures(value)
  try { return normalizeFeatures(JSON.parse(value)) } catch { return normalizeFeatures({}) }
}

async function authority(db: D1ReadClient, actor: D1AnniversaryActor): Promise<EffectResult | null> {
  const [user, family] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } }),
    db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } }),
  ])
  if (!user || user.family_id !== actor.familyId || user.role !== actor.role || user.token_version !== actor.generation) return failure(401, 'Unauthorized')
  if (!family || !isFeatureEnabled(familyFeatures(family.features), 'anniversaries')) return failure(403, 'This feature is turned off for your family')
  return null
}

function datePermissions(row: any, actor: D1AnniversaryActor, includeStorageFields = false) {
  const result = {
    id: row.id,
    name: row.name,
    type: row.type,
    date: jsonDate(row.date),
    notes: row.notes ?? null,
    person_id: row.person_id ?? null,
    created_by: row.created_by ?? null,
    can_edit: canEditOwnedRecord(actor.role, actor.userId, row.created_by),
    can_delete: actor.role === 'parent',
  }
  return includeStorageFields ? { ...result, family_id: row.family_id, created_at: jsonDate(row.created_at) } : result
}

function replayPermissions(result: NativePersonResult, actor: D1AnniversaryActor): NativePersonResult {
  const body = result.body as any
  if (!result.replayed || !body || typeof body !== 'object' || !body.date || typeof body.date !== 'object') return result
  return { ...result, body: { ...body, date: { ...body.date, can_edit: canEditOwnedRecord(actor.role, actor.userId, body.date.created_by ?? null), can_delete: actor.role === 'parent' } } }
}

function replayUpdatePermissions(result: NativePersonResult, actor: D1AnniversaryActor): NativePersonResult {
  const projected = replayPermissions(result, actor)
  const date = (projected.body as any)?.date
  if (projected.replayed && date && date.can_edit === false) return { ...projected, status: 403, body: { error: 'You can only edit dates you added' } }
  return projected
}

function actorCheck(db: Pick<D1Store, 'prepare'>, actor: D1AnniversaryActor, parentOnly = false) {
  return d1WriteCheck(db, `EXISTS (SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role=?4 AND token_version=?3)`, [actor.userId, actor.familyId, actor.generation, parentOnly ? 'parent' : actor.role])
}

async function currentPerson(db: D1ReadClient, actor: D1AnniversaryActor, id: string) {
  return db.anniversary.findFirst({ where: { id, family_id: actor.familyId }, select: { id: true, family_id: true, name: true, type: true, date: true, notes: true, person_id: true, created_by: true, created_at: true } })
}

export async function readD1Anniversaries(actor: D1AnniversaryActor, database?: D1Store): Promise<NativeResult> {
  const store = database ?? await getD1Database()
  const db = store.withSession('first-primary')
  // D1Store exposes SQL statements only; authority needs the restricted
  // read-client delegates. Passing the raw store here made the native path
  // throw when it tried to access `db.user`/`db.family`.
  const denied = await withD1ReadClient(read => authority(read, actor), store as any)
  if (denied) return denied
  const rows = await db.prepare(`SELECT id,name,type,date,notes,person_id,created_by FROM "Anniversary" WHERE family_id=?1 ORDER BY date ASC`).bind(actor.familyId).all<any>()
  const today = toDateOnlyUTC(new Date())
  const dates = rows.results.map(row => {
    const date = jsonDate(row.date) ?? new Date(0)
    const next = nextAnnualOccurrence(date, today)
    return {
      ...datePermissions(row, actor),
      date: date.toISOString(),
      days_until: next?.daysUntil ?? 0,
      next_occurrence: (jsonDate(next?.date) ?? date).toISOString(),
    }
  })
  return { status: 200, body: { dates } }
}

export function createD1Anniversary(actor: D1AnniversaryActor, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: 'anniversary.create',
    input,
    key,
    database,
    authorize: db => authority(db, actor),
    plan: async (db) => {
      if (input.person_id && !(await db.user.findFirst({ where: { id: input.person_id, family_id: actor.familyId }, select: { id: true } }))) return failure(400, 'Person not in your family')
      const now = new Date(), id = randomUUID(), date = new Date(input.date)
      const row = { id, family_id: actor.familyId, name: input.name, type: input.type, date, notes: input.notes?.trim() || null, person_id: input.person_id || null, created_by: actor.userId, created_at: now }
      return {
        status: 201,
        body: { date: datePermissions(row, actor, true) },
        effects: session => [
          actorCheck(session, actor),
          session.prepare(`INSERT INTO "Anniversary" (id,family_id,name,type,date,notes,person_id,created_by,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(id, actor.familyId, row.name, row.type, date.getTime(), row.notes, row.person_id, actor.userId, now.getTime()),
        ],
      }
    },
  }).then(result => replayPermissions(result, actor))
}

export function updateD1Anniversary(actor: D1AnniversaryActor, id: string, input: any, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: 'anniversary.update',
    input: { id, ...input },
    key,
    database,
    authorize: async db => {
      const denied = await authority(db, actor)
      if (denied) return denied
      const existing = await currentPerson(db, actor, id)
      if (!existing) {
        const receipt = key ? await db.idempotencyRecord.findFirst({ where: { scope: `user:${actor.userId}`, key, family_id: actor.familyId, user_id: actor.userId, action: 'anniversary.update' }, select: { response_status: true } }) : null
        return receipt?.response_status != null ? null : failure(404, 'Not found')
      }
      return canEditOwnedRecord(actor.role, actor.userId, existing.created_by) ? null : failure(403, 'You can only edit dates you added')
    },
    plan: async (db) => {
      const existing = await currentPerson(db, actor, id)
      if (!existing) return failure(404, 'Not found')
      if (!canEditOwnedRecord(actor.role, actor.userId, existing.created_by)) return failure(403, 'You can only edit dates you added')
      if (input.person_id && !(await db.user.findFirst({ where: { id: input.person_id, family_id: actor.familyId }, select: { id: true } }))) return failure(400, 'Person not in your family')
      const next = {
        name: input.name === undefined ? existing.name : input.name,
        type: input.type === undefined ? existing.type : input.type,
        date: input.date === undefined ? jsonDate(existing.date) : new Date(input.date),
        notes: input.notes === undefined ? existing.notes : input.notes?.trim() || null,
        person_id: input.person_id === undefined ? existing.person_id : input.person_id || null,
      }
      const nextDate = next.date
      if (!nextDate || !Number.isFinite(nextDate.getTime())) return failure(400, 'date must be a valid date')
      const row = { ...existing, ...next }
      return {
        status: 200,
        body: { date: datePermissions(row, actor, true) },
        effects: session => [
          actorCheck(session, actor),
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Anniversary" WHERE id=?1 AND family_id=?2 AND (created_by=?3 OR ?4='parent'))`, [id, actor.familyId, actor.userId, actor.role]),
          session.prepare(`UPDATE "Anniversary" SET name=?3,type=?4,date=?5,notes=?6,person_id=?7 WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId, next.name, next.type, nextDate.getTime(), next.notes, next.person_id),
        ],
      }
    },
  }).then(result => replayUpdatePermissions(result, actor))
}

export function deleteD1Anniversary(actor: D1AnniversaryActor, id: string, key: string | null, database?: D1Store): Promise<NativePersonResult> {
  return executeD1PersonEffect({
    actor,
    action: 'anniversary.delete',
    input: { id },
    key,
    database,
    authorize: db => authority(db, actor),
    plan: async (db) => {
      if (actor.role !== 'parent') return failure(403, 'Only parents can perform this action')
      if (!(await currentPerson(db, actor, id))) return failure(404, 'Not found')
      return {
        status: 200,
        body: { success: true },
        effects: session => [
          actorCheck(session, actor, true),
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "Anniversary" WHERE id=?1 AND family_id=?2)`, [id, actor.familyId]),
          session.prepare(`DELETE FROM "Anniversary" WHERE id=?1 AND family_id=?2`).bind(id, actor.familyId),
        ],
      }
    },
  })
}
