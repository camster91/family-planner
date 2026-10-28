import { randomBytes } from 'node:crypto'
import { getD1Database, type D1Store, type SqlValue } from './database'
import { D1FamilySettingsError } from './family-settings'
import { normalizeFeatures, isFeatureEnabled } from '@/lib/feature-flags'
type Actor = { userId: string; familyId: string; generation: number }
type Row = {
  role: string; family_id: string | null; token_version: number; family_exists: string | null;
  features: string | null; feed_token: string | null;
  capture_ai_key_enc: string | null; capture_ai_base_url: string | null; capture_ai_model: string | null;
  travel_mode_active: number; travel_start_date: number | null; travel_end_date: number | null; travel_destination: string | null;
}
type AiPatch = Partial<Pick<Row, 'capture_ai_key_enc' | 'capture_ai_base_url' | 'capture_ai_model'>>
type TravelPatch = { travel_mode_active?: boolean; travel_start_date?: Date | null; travel_end_date?: Date | null; travel_destination?: string | null }
const SELECT = `SELECT u.role,u.family_id,u.token_version,f.id AS family_exists,f.features,f.feed_token,
  f.capture_ai_key_enc,f.capture_ai_base_url,f.capture_ai_model,f.travel_mode_active,f.travel_start_date,f.travel_end_date,f.travel_destination
  FROM "User" u LEFT JOIN "Family" f ON f.id=?2 WHERE u.id=?1`
const PARENT = `EXISTS (SELECT 1 FROM "User" u WHERE u.id=?1 AND u.family_id=?2 AND u.role='parent' AND u.token_version=?3)`
function authorized(row: Row | null, actor: Actor, travel = false) {
  if (!row || row.role !== 'parent' || row.family_id !== actor.familyId) throw new D1FamilySettingsError(403, 'FORBIDDEN')
  if (row.token_version !== actor.generation) throw new D1FamilySettingsError(401, 'SESSION_CHANGED')
  if (!row.family_exists) throw new D1FamilySettingsError(404, 'FAMILY_NOT_FOUND')
  if (travel && !isFeatureEnabled(normalizeFeatures(row.features === null ? null : JSON.parse(row.features)), 'travel')) throw new D1FamilySettingsError(403, 'FEATURE_DISABLED')
  return row
}
const ai = (row: Row) => ({ capture_ai_key_enc: row.capture_ai_key_enc, capture_ai_base_url: row.capture_ai_base_url, capture_ai_model: row.capture_ai_model })
const travel = (row: Row) => ({ travel_mode_active: row.travel_mode_active === 1, travel_start_date: row.travel_start_date === null ? null : new Date(row.travel_start_date), travel_end_date: row.travel_end_date === null ? null : new Date(row.travel_end_date), travel_destination: row.travel_destination })
async function read(actor: Actor, database?: D1Store, needsTravel = false) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  return authorized(await db.prepare(SELECT).bind(actor.userId, actor.familyId).first<Row>(), actor, needsTravel)
}
async function update(actor: Actor, values: Array<[string, SqlValue]>, database?: D1Store, needsTravel = false) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  // Column identifiers come exclusively from the closed source-owned lists
  // below; user input is always bound. Only explicitly supplied fields change.
  const statements = values.length ? [db.prepare(`UPDATE "Family" SET ${values.map(([column], i) => `"${column}"=?${i + 4}`).join(',')}
    WHERE id=?2 AND ${PARENT}${needsTravel ? " AND json_type(features,'$.travel')='true'" : ''}`)
    .bind(actor.userId, actor.familyId, actor.generation, ...values.map(([, value]) => value))] : []
  statements.push(db.prepare(SELECT).bind(actor.userId, actor.familyId))
  const result = await db.batch<Row>(statements)
  return authorized(result.at(-1)!.results[0] ?? null, actor, needsTravel)
}
export async function readD1AiSettings(actor: Actor, database?: D1Store) { return ai(await read(actor, database)) }
export async function updateD1AiSettings(actor: Actor, patch: AiPatch, database?: D1Store) {
  const columns = ['capture_ai_key_enc', 'capture_ai_base_url', 'capture_ai_model'] as const
  const values: Array<[string, SqlValue]> = []
  for (const column of columns) if (patch[column] !== undefined) values.push([column, patch[column]!])
  return ai(await update(actor, values, database))
}
export async function readD1FeedToken(actor: Actor, database?: D1Store) { return { feedToken: (await read(actor, database)).feed_token } }
export async function ensureD1FeedToken(actor: Actor, regenerate: boolean, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const result = await db.batch<Row>([
    db.prepare(SELECT).bind(actor.userId, actor.familyId),
    db.prepare(`UPDATE "Family" SET feed_token=?4 WHERE id=?2 AND ${PARENT} AND (?5=1 OR feed_token IS NULL OR feed_token='')`)
      .bind(actor.userId, actor.familyId, actor.generation, randomBytes(24).toString('hex'), Number(regenerate)),
    db.prepare(SELECT).bind(actor.userId, actor.familyId),
  ])
  const before = authorized(result[0].results[0] ?? null, actor)
  const after = authorized(result[2].results[0] ?? null, actor)
  return { feedToken: after.feed_token, ...(!before.feed_token || regenerate ? { regenerated: Boolean(before.feed_token) } : {}) }
}
export async function readD1Travel(actor: Actor, database?: D1Store) { return travel(await read(actor, database, true)) }
export async function updateD1Travel(actor: Actor, patch: TravelPatch, database?: D1Store) {
  const values: Array<[string, SqlValue]> = []
  if (patch.travel_mode_active !== undefined) values.push(['travel_mode_active', Number(patch.travel_mode_active)])
  if (patch.travel_start_date !== undefined) values.push(['travel_start_date', patch.travel_start_date?.getTime() ?? null])
  if (patch.travel_end_date !== undefined) values.push(['travel_end_date', patch.travel_end_date?.getTime() ?? null])
  if (patch.travel_destination !== undefined) values.push(['travel_destination', patch.travel_destination])
  return travel(await update(actor, values, database, true))
}

/** One consistent Settings seed; teen/child SQL joins cannot read parent data. */
export async function readD1SettingsSeed(actor: Pick<Actor, 'userId' | 'generation'>, sharedDeviceEnabled: boolean, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const row = await db.prepare(`SELECT u.role,u.family_id,
    f.beta_metrics_enabled,CASE WHEN f.capture_ai_key_enc IS NOT NULL THEN 1 ELSE 0 END AS ai_key_stored,
    CASE WHEN p.user_id IS NOT NULL THEN 1 ELSE 0 END AS pin_present
    FROM "User" u LEFT JOIN "Family" f ON f.id=u.family_id AND u.role='parent'
    LEFT JOIN "ParentElevationPin" p ON p.user_id=u.id AND p.family_id=u.family_id AND u.role='parent' AND ?3=1
    WHERE u.id=?1 AND u.token_version=?2`)
    .bind(actor.userId, actor.generation, Number(sharedDeviceEnabled))
    .first<{ role: string; family_id: string | null; beta_metrics_enabled: number | null; ai_key_stored: number; pin_present: number }>()
  if (!row) return null
  const parent = row.role === 'parent' && row.family_id !== null
  return { role: row.role, familyId: row.family_id,
    sharedDevice: parent && sharedDeviceEnabled ? { hasPin: row.pin_present === 1 } : null,
    betaMetrics: parent && row.beta_metrics_enabled !== null ? { enabled: row.beta_metrics_enabled === 1 } : null,
    aiKeyStored: parent && row.ai_key_stored === 1 }
}
