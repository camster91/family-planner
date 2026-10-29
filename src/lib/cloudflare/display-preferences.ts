import { getD1Database, type D1Store } from './database'
import { DisplayPreferencesError } from '@/lib/display-preferences-server'
import { defaultPersonalLayout, type TodayLayout } from '@/lib/personal-layout'
import {
  personalDisplayRecordSchema, householdDisplayRecordSchema, effectivePersonalLayout,
  permittedFavorites, type PersonalDisplayRecord, type DisplaySnapshot,
} from '@/lib/display-preferences-schema'

type Actor = { userId: string; familyId: string | null; tokenVersion: number }
type Patch = { expectedRevision: number; today?: TodayLayout; favorites?: string[]; quiet?: boolean; inheritToday?: true }
type Row = {
  id: string; family_id: string | null; role: string; token_version: number;
  display_preferences: string | null; display_preferences_revision: number;
  existing_family_id: string | null; display_defaults: string | null; display_defaults_revision: number | null;
}
type Session = Pick<D1Store, 'prepare' | 'batch'>
// One SQL statement reads a consistent own-account/defaults snapshot. Household
// data never enters the response until current membership/session is validated.
const SELECT = `SELECT u.id, u.family_id, u.role, u.token_version,
  u.display_preferences, u.display_preferences_revision, f.id AS existing_family_id,
  f.display_defaults, f.display_defaults_revision FROM "User" u
  LEFT JOIN "Family" f ON f.id = u.family_id WHERE u.id = ?`
const json = (value: string | null) => value === null ? null : JSON.parse(value)
function loaded(row: Row | null, actor: Actor) {
  if (!row || row.token_version !== actor.tokenVersion) throw new DisplayPreferencesError('UNAUTHORIZED')
  if (row.family_id !== actor.familyId || !['parent', 'teen', 'child'].includes(row.role) || (actor.familyId && !row.existing_family_id)) {
    throw new DisplayPreferencesError('FORBIDDEN')
  }
  const personal = personalDisplayRecordSchema.safeParse(json(row.display_preferences) ?? { version: 1 })
  const defaults = householdDisplayRecordSchema.safeParse(json(row.display_defaults) ?? { version: 1, today: defaultPersonalLayout().today })
  if (!personal.success || !defaults.success) throw new DisplayPreferencesError('UNSUPPORTED')
  return { row, personal: personal.data, defaults: defaults.data.today }
}
function snapshot(value: ReturnType<typeof loaded>): DisplaySnapshot {
  return {
    version: 1, revision: value.row.display_preferences_revision,
    defaultsRevision: value.row.display_defaults_revision ?? 0,
    layout: effectivePersonalLayout(value.personal, value.defaults, value.row.role),
    quiet: value.personal.quiet ?? false, defaultToday: value.defaults,
    personalizedToday: value.personal.today !== undefined,
    canManageDefaults: value.row.role === 'parent' && value.row.existing_family_id !== null,
  }
}
async function read(db: Session, actor: Actor) {
  return loaded(await db.prepare(SELECT).bind(actor.userId).first<Row>(), actor)
}
export async function readD1DisplayPreferences(actor: Actor, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  return snapshot(await read(db, actor))
}
export async function updateD1DisplayPreferences(actor: Actor, patch: Patch, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const current = await read(db, actor)
  if (current.row.display_preferences_revision !== patch.expectedRevision) throw new DisplayPreferencesError('CONFLICT')
  const next: PersonalDisplayRecord = { ...current.personal }
  if (patch.inheritToday) delete next.today
  if (patch.today !== undefined) next.today = patch.today
  if (patch.quiet !== undefined) next.quiet = patch.quiet
  if (patch.favorites !== undefined) next.favorites = permittedFavorites(patch.favorites, current.row.role)
  // The SQLite batch is atomic. Bind role/membership/session again in the
  // winning UPDATE, then return exactly the committed snapshot from that batch.
  const result = await db.batch<Row>([
    db.prepare(`UPDATE "User" SET display_preferences = ?, display_preferences_revision = display_preferences_revision + 1
      WHERE id = ? AND family_id IS ? AND role = ? AND token_version = ? AND display_preferences_revision = ? RETURNING id`)
      .bind(JSON.stringify(next), actor.userId, actor.familyId, current.row.role, actor.tokenVersion, patch.expectedRevision),
    db.prepare(SELECT).bind(actor.userId),
  ])
  const committed = loaded(result[1].results[0] ?? null, actor)
  // RETURNING counts the direct winner; meta.changes also includes food-source
  // epoch trigger writes and is not a count of updated account rows.
  if (result[0].results.length !== 1) throw new DisplayPreferencesError('CONFLICT')
  return snapshot(committed)
}
export async function updateD1DisplayDefaults(actor: Actor, expectedRevision: number, today: TodayLayout, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const current = await read(db, actor)
  if (current.row.role !== 'parent' || !actor.familyId || !current.row.existing_family_id) throw new DisplayPreferencesError('FORBIDDEN')
  if (current.row.display_defaults_revision !== expectedRevision) throw new DisplayPreferencesError('CONFLICT')
  const result = await db.batch<Row>([
    db.prepare(`UPDATE "Family" SET display_defaults = ?, display_defaults_revision = display_defaults_revision + 1
      WHERE id = ? AND display_defaults_revision = ? AND EXISTS
        (SELECT 1 FROM "User" WHERE id = ? AND family_id = "Family".id AND role = 'parent' AND token_version = ?) RETURNING id`)
      .bind(JSON.stringify({ version: 1, today }), actor.familyId, expectedRevision, actor.userId, actor.tokenVersion),
    db.prepare(SELECT).bind(actor.userId),
  ])
  const committed = loaded(result[1].results[0] ?? null, actor)
  if (committed.row.role !== 'parent') throw new DisplayPreferencesError('FORBIDDEN')
  if (result[0].results.length !== 1) throw new DisplayPreferencesError('CONFLICT')
  return snapshot(committed)
}
