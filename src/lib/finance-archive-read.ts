/** FIN-0 metadata list; detail hashes a bounded stored copy server-side. No promotion or financial totals. */
import { createHash } from 'node:crypto'
import { Prisma, type PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { lockUser, lockHousehold } from '@/lib/household-lock'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { FINANCE_ARCHIVE_MODELS, FINANCE_ARCHIVE_PROTOCOL, financeArchiveModel, financeArchivePage, type FinanceArchiveModel, type FinanceArchiveOwner, FINANCE_ARCHIVE_DETAIL_PROTOCOL, FINANCE_ARCHIVE_FINGERPRINT_BYTES, financeArchiveDetails } from '@/lib/finance-archive-contract'
export const financeArchiveReviewEnabled = () => process.env.FINANCE_ARCHIVE_REVIEW_ENABLED === '1'
const position = z.tuple([z.literal(FINANCE_ARCHIVE_PROTOCOL), z.string().min(1).max(128), financeArchiveModel.nullable(), z.string().datetime(), z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)])
export type ArchivePaging = { model: FinanceArchiveModel | null; cursor: { createdAt: Date; id: string } | null }
export class FinanceArchiveReadError extends Error {
  constructor(public readonly code: 'UNAVAILABLE' | 'OWNER_CHANGED' | 'INVALID_PAGE' | 'RECORD_UNAVAILABLE') { super('Archive review is unavailable'); this.name = 'FinanceArchiveReadError' }
}
export function parseArchivePaging(params: URLSearchParams, familyId: string): ArchivePaging {
  if ([...params.keys()].some(key => !['model', 'cursor'].includes(key)) || ['model', 'cursor'].some(key => params.getAll(key).length > 1)) throw new FinanceArchiveReadError('INVALID_PAGE')
  const rawModel = params.get('model')
  const parsed = rawModel === null ? null : financeArchiveModel.safeParse(rawModel)
  if (parsed && !parsed.success) throw new FinanceArchiveReadError('INVALID_PAGE')
  const model = parsed?.success ? parsed.data : null
  const cursor = params.get('cursor')
  if (cursor === null) return { model, cursor: null }
  try {
    if (!/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error()
    const bytes = Buffer.from(cursor, 'base64url')
    if (bytes.toString('base64url') !== cursor) throw new Error()
    const tuple = position.parse(JSON.parse(bytes.toString('utf8')))
    const createdAt = new Date(tuple[3])
    if (tuple[1] !== familyId || tuple[2] !== model || createdAt.toISOString() !== tuple[3]) throw new Error()
    return { model, cursor: { createdAt, id: tuple[4] } }
  } catch { throw new FinanceArchiveReadError('INVALID_PAGE') }
}
export function archiveCursor(familyId: string, model: FinanceArchiveModel | null, row: { created_at: Date; id: string }) {
  return Buffer.from(JSON.stringify(position.parse([FINANCE_ARCHIVE_PROTOCOL, familyId, model, row.created_at.toISOString(), row.id])), 'utf8').toString('base64url')
}
async function requireFinanceArchiveOwnerInTx(tx: Prisma.TransactionClient, owner: FinanceArchiveOwner) {
    await lockUser(tx, owner.userId)
    await lockHousehold(tx, owner.familyId)
    const user = await tx.user.findUnique({ where: { id: owner.userId }, select: { family_id: true, role: true, token_version: true, family: { select: { features: true } } } })
    if (!user || user.family_id !== owner.familyId || user.token_version !== owner.generation || user.role !== 'parent') throw new FinanceArchiveReadError('OWNER_CHANGED')
    if (!isFeatureEnabled(normalizeFeatures(user.family?.features), 'budget') || !financeArchiveReviewEnabled()) throw new FinanceArchiveReadError('UNAVAILABLE')
 }

/** Original actor is server-authenticated; client context is only a precondition. */
export async function readFinanceArchivePage(db: Pick<PrismaClient, '$transaction'>, owner: FinanceArchiveOwner, page: ArchivePaging) {
  if (!financeArchiveReviewEnabled()) throw new FinanceArchiveReadError('UNAVAILABLE')
  return db.$transaction(async tx => {
    await requireFinanceArchiveOwnerInTx(tx, owner)
    // CASE limits the group result to twelve keys, including unknown models.
    const groups = await tx.$queryRaw<{ model: string; count: string }[]>(Prisma.sql`
      SELECT CASE WHEN "source_model" = ANY(${[...FINANCE_ARCHIVE_MODELS]}::text[])
        THEN "source_model" ELSE 'other' END AS model, count(*)::text AS count
      FROM "FinancialArchiveRecord" WHERE "family_id" = ${owner.familyId} GROUP BY 1`)
    const counts = [...FINANCE_ARCHIVE_MODELS, 'other' as const].map(model => ({ model, count: groups.find(row => row.model === model)?.count ?? '0' }))
    const filter = page.model === null ? Prisma.empty : page.model === 'other'
      ? Prisma.sql`AND NOT ("source_model" = ANY(${[...FINANCE_ARCHIVE_MODELS]}::text[]))`
      : Prisma.sql`AND "source_model" = ${page.model}`
    const after = page.cursor ? Prisma.sql`AND ("created_at" < ${page.cursor.createdAt} OR ("created_at" = ${page.cursor.createdAt} AND "id" > ${page.cursor.id}))` : Prisma.empty
    // Bound source display strings in SQL; no raw payload reaches Node/browser.
    const rows = await tx.$queryRaw<{ id: string; created_at: Date; source_app: string; source_model: string; source_id: string; truncated: boolean }[]>(Prisma.sql`
      SELECT "id", "created_at", left("source_app", 80) AS source_app,
        left("source_model", 80) AS source_model, left("source_id", 160) AS source_id,
        (length("source_app") > 80 OR length("source_model") > 80 OR length("source_id") > 160) AS truncated
      FROM "FinancialArchiveRecord" WHERE "family_id" = ${owner.familyId} ${filter} ${after}
      ORDER BY "created_at" DESC, "id" ASC LIMIT 25`)
    const visible = rows.slice(0, 24)
    return financeArchivePage.parse({ protocol: FINANCE_ARCHIVE_PROTOCOL, owner, model: page.model, counts,
      rows: visible.map(row => ({ id: row.id, createdAt: row.created_at.toISOString(), sourceApp: row.source_app, sourceModel: row.source_model, sourceId: row.source_id, sourceLabelsTruncated: row.truncated })),
      nextCursor: rows.length > 24 && visible.length ? archiveCursor(owner.familyId, page.model, visible[visible.length - 1]) : null,
    })
  }, { timeout: 5000 })
}

/** One exact owned snapshot; raw JSON text is bounded and hashed only on server. */
export async function readFinanceArchiveDetails(db: Pick<PrismaClient, '$transaction'>, owner: FinanceArchiveOwner, recordId: string) {
  if (!financeArchiveReviewEnabled()) throw new FinanceArchiveReadError('UNAVAILABLE')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(recordId)) throw new FinanceArchiveReadError('INVALID_PAGE')
  return db.$transaction(async tx => {
    await requireFinanceArchiveOwnerInTx(tx, owner)
    const sizes = await tx.$queryRaw<{ bytes: number | null }[]>(Prisma.sql`
      SELECT octet_length("payload"::text) AS bytes FROM "FinancialArchiveRecord"
      WHERE "family_id" = ${owner.familyId} AND "id" = ${recordId} FOR SHARE`)
    if (sizes.length !== 1) throw new FinanceArchiveReadError('RECORD_UNAVAILABLE')
    const bytes = sizes[0].bytes
    let fingerprint: { state: 'available' | 'too-large' | 'unavailable'; bytes: number | null; sha256: string | null } = { state: 'unavailable', bytes: null, sha256: null }
    if (typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > FINANCE_ARCHIVE_FINGERPRINT_BYTES) {
      fingerprint = { state: 'too-large', bytes, sha256: null }
    } else if (typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes > 0) {
      const bodies = await tx.$queryRaw<{ body: string }[]>(Prisma.sql`
        SELECT "payload"::text AS body FROM "FinancialArchiveRecord"
        WHERE "family_id" = ${owner.familyId} AND "id" = ${recordId}
          AND octet_length("payload"::text) <= ${FINANCE_ARCHIVE_FINGERPRINT_BYTES} LIMIT 1`)
      if (bodies.length === 1 && typeof bodies[0].body === 'string' && Buffer.byteLength(bodies[0].body, 'utf8') === bytes) {
        fingerprint = { state: 'available', bytes, sha256: createHash('sha256').update(bodies[0].body, 'utf8').digest('hex') }
      }
    }
    // Match the original source identity AND target, then scope the job too.
    // Never guess a version from the latest job, another household, or a name.
    const provenance = await tx.$queryRaw<{ source_version: string | null; truncated: boolean; completed: boolean | null; job_present: boolean }[]>(Prisma.sql`
      SELECT left(j."source_version", 80) AS source_version,
        COALESCE(length(j."source_version") > 80, false) AS truncated,
        (j."status" = 'completed' AND j."dry_run" = false) AS completed, (j."id" IS NOT NULL) AS job_present
      FROM "FinancialArchiveRecord" a JOIN "ImportedRecord" i
        ON i."family_id" = a."family_id" AND i."source_app" = a."source_app"
        AND i."source_model" = a."source_model" AND i."source_id" = a."source_id"
        AND i."target_model" = 'FinancialArchiveRecord' AND i."target_id" = a."id"
      LEFT JOIN "ImportJob" j ON j."id" = i."import_job_id" AND j."family_id" = a."family_id" AND j."source_app" = a."source_app"
      WHERE a."family_id" = ${owner.familyId} AND a."id" = ${recordId} LIMIT 2`)
    const matched = provenance.length === 1 && provenance[0].job_present === true && provenance[0].completed === true
    const row = matched ? provenance[0] : null
    return financeArchiveDetails.parse({ protocol: FINANCE_ARCHIVE_DETAIL_PROTOCOL, owner, recordId, fingerprint,
      provenance: { state: provenance.length > 1 ? 'ambiguous' : matched ? 'matched' : 'unavailable',
        sourceVersion: row?.source_version || null, versionTruncated: row?.truncated ?? false },
    })
  }, { timeout: 5000 })
}
