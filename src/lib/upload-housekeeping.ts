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

import path from 'path'
import { unlink } from 'fs/promises'
import { CHORE_PHOTO_FILENAME_RE, chorePhotoFilename } from '@/lib/chore-photos'
import { log } from '@/lib/logger'

/** Most photos one user may upload per hour. */
export const UPLOAD_RATE_LIMIT_MAX = 30
export const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000

/** Total stored bytes per household, across every Upload row. */
export const FAMILY_UPLOAD_QUOTA_BYTES = 500 * 1024 * 1024
export const FAMILY_UPLOAD_QUOTA_MESSAGE =
  'Your family has used all of its photo storage (500 MB). Remove some photos from chores or the board and try again.'

/** Unreferenced uploads younger than this are left alone (a form may still be about to use them). */
export const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000
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

    // Re-state every condition on the delete so a row that changed in between
    // (e.g. re-attached) is not removed by a stale read of the id alone.
    const ids = stale.map((u) => u.id)
    const { count } = await db.upload.deleteMany({
      where: { id: { in: ids }, family_id: familyId, created_at: { lt: cutoff } },
    })
    // Only remove files whose row is really gone.
    const survivors: Array<{ id: string }> =
      count === ids.length ? [] : await db.upload.findMany({ where: { id: { in: ids } }, select: { id: true } })
    const kept = new Set(survivors.map((u) => u.id))

    const remove = options.removeFile ?? ((p: string) => unlink(p))
    const root = path.resolve(options.uploadDir, 'chores')
    for (const { id, filename } of stale) {
      if (kept.has(id)) continue
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
