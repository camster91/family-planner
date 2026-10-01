/**
 * Household audit history (#285, PR101 D-4; ADR-0008).
 *
 * What a parent changed in the household's settings, for parents to read
 * under Settings -> Recent changes (`GET /api/audit`). Rules:
 *
 * - Written in the SAME transaction as the change (callers pass their `tx`),
 *   so a row exists exactly when the change committed. Unlike the shared
 *   tablet's `DeviceAuditEvent` trail (`src/lib/device-audit.ts`, best effort,
 *   security events, 180 days), a failed audit write fails the change.
 * - `action` is a fixed vocabulary (`AUDIT_ACTIONS`). `summary` is one short
 *   sentence built here from a fixed template plus names only (a feature's
 *   title, a member's or a tablet's name, a role word). Never an email, a
 *   code, a token, a PIN, a place, a colour value or other free text.
 * - Kept 12 months (`AUDIT_RETENTION_MS`): older rows are pruned when a parent
 *   reads the history (no scheduled job). Deleted with the household.
 */
import type { Prisma } from '@prisma/client'
import { FEATURES, type FamilyFeatures, type FeatureKey } from '@/lib/features'

export const AUDIT_ACTIONS = [
  'feature.turned_on',
  'feature.turned_off',
  'member.joined',
  'member.left',
  // O-34: a parent removed a member; a parent got a new family code.
  'member.removed',
  'invite_code.rotated',
  'board_settings.changed',
  'device.paired',
  'device.renamed',
  'device.removed',
  'invite.created',
  'invite.revoked',
  'beta_metrics.turned_on',
  'beta_metrics.turned_off',
] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

export type AuditActorKind = 'person' | 'device'
export type AuditTargetType = 'family' | 'feature' | 'member' | 'device' | 'invite'

/** Retention (#285): 12 months, counted as 365 days. */
export const AUDIT_RETENTION_MS = 365 * 24 * 60 * 60 * 1000
export const AUDIT_PAGE_DEFAULT = 20
export const AUDIT_PAGE_MAX = 50
/** Longest stored summary; templates stay well under it, names are clipped. */
export const AUDIT_SUMMARY_MAX = 200

export interface AuditEntry {
  familyId: string
  actorUserId: string | null
  actorKind: AuditActorKind
  action: AuditAction
  targetType: AuditTargetType
  targetId: string | null
  summary: string
}

type AuditDb = Pick<Prisma.TransactionClient, 'auditLog'>

/** Names are the only user text in a summary: one line, no control characters, clipped. */
export function auditName(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return fallback
  return clean.length > 60 ? `${clean.slice(0, 59)}…` : clean
}

function clip(summary: string): string {
  return summary.length > AUDIT_SUMMARY_MAX ? `${summary.slice(0, AUDIT_SUMMARY_MAX - 1)}…` : summary
}

function toRow(entry: AuditEntry) {
  if (!(AUDIT_ACTIONS as readonly string[]).includes(entry.action)) throw new Error('Unknown audit action')
  return {
    family_id: entry.familyId,
    actor_user_id: entry.actorUserId,
    actor_kind: entry.actorKind,
    action: entry.action,
    target_type: entry.targetType,
    target_id: entry.targetId,
    summary: clip(entry.summary),
  }
}

/**
 * Record entries inside the caller's transaction. Errors propagate on purpose:
 * the change and its history commit or roll back together.
 */
export async function writeAuditLog(db: AuditDb, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries]
  if (list.length === 0) return
  if (list.length === 1) {
    await db.auditLog.create({ data: toRow(list[0]), select: { id: true } })
    return
  }
  await db.auditLog.createMany({ data: list.map(toRow) })
}

// ---------------------------------------------------------------------------
// Summaries (fixed templates)

const ROLE_WORD: Record<string, string> = { parent: 'a parent', teen: 'a teen', child: 'a child' }

export function roleWord(role: string): string {
  return ROLE_WORD[role] ?? 'a member'
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** One entry per feature whose effective stored value changed. */
export function featureAuditEntries(
  before: FamilyFeatures,
  after: FamilyFeatures,
  base: Pick<AuditEntry, 'familyId' | 'actorUserId' | 'actorKind'>
): AuditEntry[] {
  const out: AuditEntry[] = []
  for (const feature of FEATURES) {
    const key = feature.key as FeatureKey
    if (Boolean(before[key]) === Boolean(after[key])) continue
    const on = Boolean(after[key])
    out.push({
      ...base,
      action: on ? 'feature.turned_on' : 'feature.turned_off',
      targetType: 'feature',
      targetId: key,
      summary: `Turned ${on ? 'on' : 'off'} ${feature.title}`,
    })
  }
  return out
}

const SECTION_WORDS: Record<string, string> = {
  weather: 'weather',
  memberColors: 'member colours',
  display: 'calm display',
  deviceWrites: 'tablet changes',
}

/** "Changed the Today board settings: weather and member colours". Section names only, never values. */
export function boardSettingsSummary(sections: readonly string[]): string {
  const words = sections.map((s) => SECTION_WORDS[s]).filter(Boolean)
  if (words.length === 0) return 'Changed the Today board settings'
  const list = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
  return `Changed the Today board settings: ${list}`
}

const REMOVE_REASON: Record<string, string> = {
  lost: ' (lost)',
  replaced: ' (replaced by a new tablet)',
  parent: '',
}

export const auditSummary = {
  memberJoined: (name: string | null | undefined, role: string) =>
    `${auditName(name, 'A former member')} joined as ${roleWord(role)}`,
  /** Role word only: the account and its name are being deleted (#292). */
  memberLeft: (role: string) => `${capitalise(roleWord(role))} deleted their account and left the household`,
  devicePaired: (label: string | null | undefined) => `Paired the tablet “${auditName(label, 'Family tablet')}”`,
  deviceRenamed: (from: string | null | undefined, to: string | null | undefined) =>
    `Renamed the tablet “${auditName(from, 'Family tablet')}” to “${auditName(to, 'Family tablet')}”`,
  deviceRemoved: (label: string | null | undefined, reason: string) =>
    `Removed the tablet “${auditName(label, 'Family tablet')}”${REMOVE_REASON[reason] ?? ''}`,
  /** O-34: the removed member's name and role word (they keep their account). */
  memberRemoved: (name: string | null | undefined, role: string) =>
    `Removed ${auditName(name, 'a member')} (${roleWord(role)}) from the household`,
  /** O-34: never the code itself. */
  inviteCodeRotated: () => 'Got a new family code; the old code no longer works',
  inviteCreated: (role: string) => `Sent an invite to join as ${roleWord(role)}`,
  inviteRevoked: (role: string) => `Cancelled an invite to join as ${roleWord(role)}`,
  /** Beta usage counts (#287). Off also deleted the stored counts. */
  betaMetrics: (on: boolean) =>
    on ? 'Turned on beta usage counts' : 'Turned off beta usage counts and deleted the stored counts',
}

// ---------------------------------------------------------------------------
// Reading

export interface AuditCursor {
  createdAt: Date
  id: string
}

export function encodeAuditCursor(row: { created_at: Date; id: string }): string {
  return Buffer.from(`${row.created_at.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

export function decodeAuditCursor(raw: string): AuditCursor | null {
  if (raw.length === 0 || raw.length > 200) return null
  let text: string
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8')
  } catch {
    return null
  }
  const bar = text.indexOf('|')
  if (bar <= 0) return null
  const createdAt = new Date(text.slice(0, bar))
  const id = text.slice(bar + 1)
  if (Number.isNaN(createdAt.getTime()) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  return { createdAt, id }
}

export type AuditQuery = { ok: true; limit: number; cursor: AuditCursor | null } | { ok: false; error: string }

export function parseAuditQuery(params: URLSearchParams): AuditQuery {
  const rawLimit = params.get('limit')
  let limit = AUDIT_PAGE_DEFAULT
  if (rawLimit !== null) {
    if (!/^\d{1,3}$/.test(rawLimit)) return { ok: false, error: `limit must be a whole number from 1 to ${AUDIT_PAGE_MAX}` }
    limit = Number(rawLimit)
    if (limit < 1 || limit > AUDIT_PAGE_MAX) {
      return { ok: false, error: `limit must be a whole number from 1 to ${AUDIT_PAGE_MAX}` }
    }
  }
  const rawCursor = params.get('cursor')
  let cursor: AuditCursor | null = null
  if (rawCursor !== null) {
    cursor = decodeAuditCursor(rawCursor)
    if (!cursor) return { ok: false, error: 'Invalid cursor' }
  }
  return { ok: true, limit, cursor }
}

export interface AuditEntryDto {
  id: string
  action: string
  actorKind: AuditActorKind
  /** Null when no person is recorded or the member has since been deleted. */
  actor: { id: string; name: string } | null
  targetType: string
  targetId: string | null
  summary: string
  createdAt: string
}

type ReadDb = Pick<Prisma.TransactionClient, 'auditLog'>

/**
 * One page of `familyId`'s history, newest first, after pruning rows past
 * retention. `nextCursor` is null on the last page.
 */
export async function readAuditPage(
  db: ReadDb,
  familyId: string,
  opts: { limit: number; cursor: AuditCursor | null; now: Date }
): Promise<{ entries: AuditEntryDto[]; nextCursor: string | null }> {
  const cutoff = new Date(opts.now.getTime() - AUDIT_RETENTION_MS)
  await db.auditLog.deleteMany({ where: { family_id: familyId, created_at: { lt: cutoff } } })

  const where: Prisma.AuditLogWhereInput = { family_id: familyId }
  if (opts.cursor) {
    where.OR = [
      { created_at: { lt: opts.cursor.createdAt } },
      { created_at: opts.cursor.createdAt, id: { lt: opts.cursor.id } },
    ]
  }
  const rows = await db.auditLog.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
    select: {
      id: true,
      action: true,
      actor_kind: true,
      actor_user_id: true,
      target_type: true,
      target_id: true,
      summary: true,
      created_at: true,
      // Only a member of this household is named; a moved-away member reads as unknown.
      actor: { select: { id: true, name: true, family_id: true } },
    },
  })
  const page = rows.slice(0, opts.limit)
  const entries = page.map((r) => ({
    id: r.id,
    action: r.action,
    actorKind: r.actor_kind === 'device' ? ('device' as const) : ('person' as const),
    actor: r.actor && r.actor.family_id === familyId ? { id: r.actor.id, name: r.actor.name } : null,
    targetType: r.target_type,
    targetId: r.target_id,
    summary: r.summary,
    createdAt: r.created_at.toISOString(),
  }))
  const last = page[page.length - 1]
  return { entries, nextCursor: rows.length > opts.limit && last ? encodeAuditCursor(last) : null }
}
