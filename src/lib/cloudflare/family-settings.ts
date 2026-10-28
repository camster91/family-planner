import { prepareD1BetaMetricConsentErasure } from '@/lib/beta-metrics'
import { randomUUID } from 'node:crypto'
import { getD1Database, type D1Store } from './database'
import { normalizeFeatures, defaultFeatures, type FeatureKey } from '@/lib/feature-flags'
import { featureAuditEntries, auditSummary, AUDIT_RETENTION_MS, encodeAuditCursor, type AuditCursor, type AuditEntryDto } from '@/lib/household-audit'

type Actor = { userId: string; familyId: string; generation: number }
type State = {
  role: string; family_id: string | null; token_version: number; family_exists: string | null;
  name: string | null; subscription_tier: string | null; created_at: number | null;
  features: string | null; beta_metrics_enabled: number | null;
}
type AuditRow = {
  id: string; action: string; actor_kind: string; actor_id: string | null; actor_name: string | null;
  target_type: string; target_id: string | null; summary: string; created_at: number;
}
const SELECT = `SELECT u.role,u.family_id,u.token_version,f.id AS family_exists,f.name,
  f.subscription_tier,f.created_at,f.features,f.beta_metrics_enabled
  FROM "User" u LEFT JOIN "Family" f ON f.id=?1 WHERE u.id=?2`
const PARENT = `EXISTS (SELECT 1 FROM "User" a WHERE a.id=?1 AND a.family_id=?2 AND a.role='parent' AND a.token_version=?3)`
export class D1FamilySettingsError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code) }
}
function authorized(row: State | null, actor: Actor, parent = true) {
  if (!row || row.family_id !== actor.familyId || (parent && row.role !== 'parent')) throw new D1FamilySettingsError(403, 'FORBIDDEN')
  if (row.token_version !== actor.generation) throw new D1FamilySettingsError(401, 'SESSION_CHANGED')
  if (!row.family_exists) throw new D1FamilySettingsError(404, 'FAMILY_NOT_FOUND')
  return row
}
const flags = (raw: string | null) => raw === null ? defaultFeatures() : normalizeFeatures(JSON.parse(raw))
const display = (row: State) => ({
  id: row.family_exists!, name: row.name!, subscription_tier: row.subscription_tier!,
  created_at: new Date(row.created_at!), features: row.features === null ? null : JSON.parse(row.features),
})
export async function renameD1Family(input: { familyId: string; name?: string; baseName?: string }, actor: Actor, database?: D1Store) {
  if (input.familyId !== actor.familyId) throw new D1FamilySettingsError(403, 'FORBIDDEN')
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const statements = []
  if (input.name) {
    statements.push(db.prepare(`UPDATE "Family" SET name=?4 WHERE id=?2 AND ${PARENT}
      AND name<>?4 AND (?5 IS NULL OR name=?5 OR name=?4)`)
      .bind(actor.userId, actor.familyId, actor.generation, input.name, input.baseName ?? null))
  }
  statements.push(db.prepare(SELECT).bind(actor.familyId, actor.userId))
  const result = await db.batch<State>(statements)
  const row = authorized(result.at(-1)!.results[0] ?? null, actor)
  if (input.baseName !== undefined && row.name !== input.baseName && row.name !== input.name) throw new D1FamilySettingsError(409, 'FAMILY_NAME_CHANGED')
  return { family: display(row) }
}
export async function readD1FamilyFeatures(actor: Actor, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  return flags(authorized(await db.prepare(SELECT).bind(actor.familyId, actor.userId).first<State>(), actor, false).features)
}
export async function updateD1FamilyFeatures(actor: Actor, changes: Partial<Record<FeatureKey, boolean>>, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  // Each retry merges only the requested keys into the latest stored flags.
  // The complete JSON compare-and-set prevents lost concurrent parent toggles.
  for (let attempt = 0; attempt < 16; attempt++) {
    const before = authorized(await db.prepare(SELECT).bind(actor.familyId, actor.userId).first<State>(), actor)
    const current = flags(before.features)
    const next = { ...current, ...changes }
    const entries = featureAuditEntries(current, next, { familyId: actor.familyId, actorUserId: actor.userId, actorKind: 'person' })
    const result = await db.batch<State>([
      db.prepare(`UPDATE "Family" SET features=?4 WHERE id=?2 AND ${PARENT} AND features IS ?5`)
        .bind(actor.userId, actor.familyId, actor.generation, JSON.stringify(next), before.features),
      ...entries.map(entry => db.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
        SELECT ?1,?2,?3,'person',?4,'feature',?5,?6,?7 WHERE changes()=1`)
        .bind(randomUUID(), actor.familyId, actor.userId, entry.action, entry.targetId, entry.summary, Date.now())),
      db.prepare(SELECT).bind(actor.familyId, actor.userId),
    ])
    const committed = authorized(result.at(-1)!.results[0] ?? null, actor)
    if (result[0].meta.changes === 1) return flags(committed.features)
  }
  throw new D1FamilySettingsError(409, 'FEATURES_CHANGED')
}
export async function updateD1BetaMetrics(actor: Actor, enabled: boolean, database?: D1Store) {
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const result = await db.batch<State>([
    db.prepare(`INSERT INTO "AuditLog" (id,family_id,actor_user_id,actor_kind,action,target_type,target_id,summary,created_at)
      SELECT ?4,id,?1,'person',?5,'family',id,?6,?7 FROM "Family"
      WHERE id=?2 AND ${PARENT} AND beta_metrics_enabled<>?8`)
      .bind(actor.userId, actor.familyId, actor.generation, randomUUID(), enabled ? 'beta_metrics.turned_on' : 'beta_metrics.turned_off', auditSummary.betaMetrics(enabled), Date.now(), Number(enabled)),
    db.prepare(`UPDATE "Family" SET beta_metrics_enabled=?4 WHERE id=?2 AND ${PARENT}`)
      .bind(actor.userId, actor.familyId, actor.generation, Number(enabled)),
    prepareD1BetaMetricConsentErasure(db, actor, enabled),
    db.prepare(SELECT).bind(actor.familyId, actor.userId),
  ])
  const row = authorized(result.at(-1)!.results[0] ?? null, actor)
  return { enabled: row.beta_metrics_enabled === 1 }
}

/** Parent-only recent changes, with scoped event-driven retention. */
export async function readD1AuditPage(actor: Actor, opts: { limit: number; cursor: AuditCursor | null; now: Date }, database?: D1Store) {
  if (!Number.isSafeInteger(opts.limit) || opts.limit < 1 || opts.limit > 50) throw new RangeError('Invalid audit limit')
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const cutoff = opts.now.getTime() - AUDIT_RETENTION_MS
  const result = await db.batch<State | AuditRow>([
    db.prepare(`DELETE FROM "AuditLog" WHERE family_id=?2 AND created_at<?4 AND ${PARENT}`)
      .bind(actor.userId, actor.familyId, actor.generation, cutoff),
    db.prepare(SELECT).bind(actor.familyId, actor.userId),
    db.prepare(`SELECT h.id,h.action,h.actor_kind,p.id AS actor_id,p.name AS actor_name,h.target_type,h.target_id,h.summary,h.created_at
      FROM "AuditLog" h LEFT JOIN "User" p ON p.id=h.actor_user_id AND p.family_id=h.family_id
      WHERE h.family_id=?2 AND h.created_at>=?4 AND ${PARENT}
        AND (?5 IS NULL OR h.created_at<?5 OR (h.created_at=?5 AND h.id<?6))
      ORDER BY h.created_at DESC,h.id DESC LIMIT ?7`)
      .bind(actor.userId, actor.familyId, actor.generation, cutoff, opts.cursor?.createdAt.getTime() ?? null, opts.cursor?.id ?? null, opts.limit + 1),
  ])
  authorized((result[1].results[0] as State | undefined) ?? null, actor)
  const rows = result[2].results as AuditRow[]
  const page = rows.slice(0, opts.limit)
  const entries: AuditEntryDto[] = page.map(row => ({
    id: row.id, action: row.action, actorKind: row.actor_kind === 'device' ? 'device' : 'person',
    actor: row.actor_id ? { id: row.actor_id, name: row.actor_name! } : null,
    targetType: row.target_type, targetId: row.target_id, summary: row.summary,
    createdAt: new Date(row.created_at).toISOString(),
  }))
  const last = page.at(-1)
  return { entries, nextCursor: rows.length > opts.limit && last ? encodeAuditCursor({ id: last.id, created_at: new Date(last.created_at) }) : null }
}
