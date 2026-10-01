// Upload limits and opportunistic cleanup for POST /api/upload.
//
// Limits (one place): a per-user rate limit, and a per-household storage quota
// summed over the family's Upload rows.
//
// Cleanup runs inside the upload request (no scheduler, AGENTS.md): each
// upload removes up to STALE_UPLOAD_BATCH of the SAME household's Upload rows
// (and their files) that are older than STALE_UPLOAD_AGE_MS and referenced by
// nothing. References are:
//   * Chore.photo_url and ChoreAssignment.photo_url, in any accepted spelling
//     (`/api/files/chores/<f>`, legacy `/api/files/<f>`, bare `<f>`);
//   * Family.ambient_photo_ids (Upload ids picked for the fridge board).
// An upload is only ever attachable by its own household (chore-photos.ts), so
// only this household's rows are consulted. Cleanup never fails the upload.
//
// Concurrency: candidates are picked outside any lock, then removed in one
// transaction that takes the household lock (orders it with household and
// member deletion and with the upload transaction, household-lock.ts) and the
// Family row lock that board-settings PATCH holds while it validates and saves
// `ambient_photo_ids` (`lockBoardSettings`). Under those locks every
// reference to the candidates is read again and anything referenced is kept,
// so a photo picked for the board or attached to a chore after the candidate
// read is not removed. A board pick is fully serialised with the delete. Chore
// photo writes validate their Upload row without a lock, so a chore write that
// validated before this transaction and saves after it can still name a removed
// row; only an Upload older than STALE_UPLOAD_AGE_MS that nothing referenced is
// exposed to that, and the photo then reads as missing (404), never another
// household's file.

import path from 'path'
import { unlink } from 'fs/promises'
import { CHORE_PHOTO_FILENAME_RE, chorePhotoFilename, chorePhotoPath } from '@/lib/chore-photos'
import { lockHouseholdForJoin } from '@/lib/household-lock'
import { log } from '@/lib/logger'

/** Most photos one user may upload per hour. */
export const UPLOAD_RATE_LIMIT_MAX = 30
export const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** Total stored bytes per household, across every Upload row. */
export const FAMILY_UPLOAD_QUOTA_BYTES = 500 * 1024 * 1024
export const FAMILY_UPLOAD_QUOTA_MESSAGE =
  'Your family has used all of its photo storage (500 MB). Remove some photos from chores or the board and try again.'

/**
 * Unreferenced uploads younger than this are left alone. The board photo
 * picker lists every household upload, so a photo a parent un-picked stays
 * choosable for a month before it is cleared (O-35).
 */
export const STALE_UPLOAD_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Most stale uploads removed per upload request. */
export const STALE_UPLOAD_BATCH = 20
/** Above this many referenced photos the exclusion list is too large for one query: skip cleanup. */
const MAX_REFERENCED_FOR_CLEANUP = 10_000

// Structural client type so tests can pass the fake Prisma client.
type Db = {
  upload: any
  chore: any
  choreAssignment: any
  family: any
  $transaction: (fn: (tx: any) => Promise<any>) => Promise<any>
  $queryRaw: any
}

/** Bytes currently stored for a household. */
export async function familyUploadBytes(db: Pick<Db, 'upload'>, familyId: string): Promise<number> {
  const agg = await db.upload.aggregate({ where: { family_id: familyId }, _sum: { size_bytes: true } })
  return Number(agg?._sum?.size_bytes ?? 0)
}

/** The filename a stored photo_url names, in any accepted spelling, or null. */
function referencedFilename(photoUrl: string): string | null {
  const name = chorePhotoFilename(photoUrl) ?? photoUrl.replace(/^\/api\/files\//, '')
  return CHORE_PHOTO_FILENAME_RE.test(name) ? name : null
}

export interface PruneOptions {
  /** Upload root (UPLOAD_DIR); files live under `<root>/chores`. */
  uploadDir: string
  /** A filename the current request is using: never removed. */
  keepFilename?: string
  now?: number
  removeFile?: (absolutePath: string) => Promise<void>
}

/**
 * Remove up to STALE_UPLOAD_BATCH stale, unreferenced uploads of one
 * household. Returns how many rows were removed. Never throws.
 */
export async function pruneUnreferencedUploads(db: Db, familyId: string, options: PruneOptions): Promise<number> {
  try {
    const now = options.now ?? Date.now()
    const cutoff = new Date(now - STALE_UPLOAD_AGE_MS)

    const [chores, assignments, family] = await Promise.all([
      db.chore.findMany({ where: { family_id: familyId, photo_url: { not: null } }, select: { photo_url: true } }),
      db.choreAssignment.findMany({
        where: { family_id: familyId, photo_url: { not: null } },
        select: { photo_url: true },
      }),
      db.family.findUnique({ where: { id: familyId }, select: { ambient_photo_ids: true } }),
    ])

    const referenced = new Set<string>()
    for (const row of [...chores, ...assignments] as Array<{ photo_url: string | null }>) {
      const name = row.photo_url ? referencedFilename(row.photo_url) : null
      if (name) referenced.add(name)
    }
    if (options.keepFilename) referenced.add(options.keepFilename)
    const ambientIds: string[] = Array.isArray(family?.ambient_photo_ids) ? family.ambient_photo_ids : []
    if (referenced.size + ambientIds.length > MAX_REFERENCED_FOR_CLEANUP) return 0

    const stale: Array<{ id: string; filename: string }> = await db.upload.findMany({
      where: {
        family_id: familyId,
        created_at: { lt: cutoff },
        ...(referenced.size > 0 ? { filename: { notIn: [...referenced] } } : {}),
        ...(ambientIds.length > 0 ? { id: { notIn: ambientIds } } : {}),
      },
      select: { id: true, filename: true },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: STALE_UPLOAD_BATCH,
    })
    if (stale.length === 0) return 0

    const ids = stale.map((u) => u.id)
    const removedIds: string[] = await db.$transaction(async (tx: any) => {
      // Household lock first (household-lock.ts order), then the Family row
      // lock board-settings PATCH holds while it saves ambient_photo_ids.
      if (!(await lockHouseholdForJoin(tx, familyId))) return []
      await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${familyId} FOR UPDATE`

      // Re-read every reference to the candidates under the locks.
      const spellings = stale.flatMap(({ filename }) => [chorePhotoPath(filename), `/api/files/${filename}`, filename])
      const [choreRefs, assignmentRefs, lockedFamily] = await Promise.all([
        tx.chore.findMany({ where: { family_id: familyId, photo_url: { in: spellings } }, select: { photo_url: true } }),
        tx.choreAssignment.findMany({
          where: { family_id: familyId, photo_url: { in: spellings } },
          select: { photo_url: true },
        }),
        tx.family.findUnique({ where: { id: familyId }, select: { ambient_photo_ids: true } }),
      ])
      const nowReferenced = new Set<string>()
      for (const row of [...choreRefs, ...assignmentRefs] as Array<{ photo_url: string | null }>) {
        const name = row.photo_url ? referencedFilename(row.photo_url) : null
        if (name) nowReferenced.add(name)
      }
      const onBoard = new Set<string>(Array.isArray(lockedFamily?.ambient_photo_ids) ? lockedFamily.ambient_photo_ids : [])
      const deletable = stale.filter((u) => !nowReferenced.has(u.filename) && !onBoard.has(u.id)).map((u) => u.id)
      if (deletable.length === 0) return []

      // Re-state every condition on the delete so a row that changed in
      // between is not removed by a stale read of the id alone.
      const { count } = await tx.upload.deleteMany({
        where: { id: { in: deletable }, family_id: familyId, created_at: { lt: cutoff } },
      })
      if (count === deletable.length) return deletable
      const survivors: Array<{ id: string }> = await tx.upload.findMany({
        where: { id: { in: deletable } },
        select: { id: true },
      })
      const left = new Set(survivors.map((u) => u.id))
      return deletable.filter((id) => !left.has(id))
    })
    const count = removedIds.length
    // Only remove files whose row is really gone.
    const removed = new Set(removedIds)

    const remove = options.removeFile ?? ((p: string) => unlink(p))
    const root = path.resolve(options.uploadDir, 'chores')
    for (const { id, filename } of stale) {
      if (!removed.has(id)) continue
      if (!CHORE_PHOTO_FILENAME_RE.test(filename)) continue
      await remove(path.join(root, filename)).catch((error: unknown) => {
        // ENOENT is fine (already gone); anything else is logged, not thrown.
        if ((error as { code?: string })?.code !== 'ENOENT') log.warn('upload.cleanup.file_remove_failed')
      })
    }
    if (count > 0) log.info('upload.cleanup', { removed: count })
    return count
  } catch (error) {
    log.error('upload.cleanup.failed', error, {})
    return 0
  }
}
