import { randomUUID } from 'node:crypto'
import type { D1Store, SqlValue } from './database'
import { getD1Database } from './database'
import { captureD1Reads } from './read-witness'
import type { NativeD1 } from './read-client'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { privateObjectGenerationKey, privateObjectKey, type PrivateObjectStore } from './storage'
import { CHORE_PHOTO_FILENAME_RE, chorePhotoPath } from '@/lib/chore-photos'

export const D1_FAMILY_UPLOAD_QUOTA_BYTES = 500 * 1024 * 1024
export const D1_STALE_UPLOAD_AGE_MS = 30 * 24 * 60 * 60 * 1000
export const D1_STALE_UPLOAD_BATCH = 20
const D1_UPLOAD_LEASE_RETRY_MS = 5
const D1_UPLOAD_LEASE_STALE_MS = 5 * 60 * 1000

type UploadActor = { userId: string; familyId: string; generation: number }
type UploadRow = { id: string; family_id: string; filename: string; content_type: string; size_bytes: number }

export type D1UploadResult =
  | { kind: 'ok'; row: UploadRow; created: boolean }
  | { kind: 'gone' }
  | { kind: 'collision' }
  | { kind: 'quota' }

function sessionOf(db: D1Store) {
  return db.withSession('first-primary')
}

/**
 * Publish a chore photo to private R2 and atomically admit its D1 ownership
 * row. R2 is intentionally outside the D1 batch: on every failure we inspect
 * the authoritative row before deleting an object, so a concurrent uploader
 * can never lose an object it owns. A family-prefixed key also prevents
 * foreign-household adoption.
 */
export async function storeD1ChoreUpload(options: {
  actor: UploadActor
  bytes: Uint8Array
  filename: string
  contentType: string
  bucket?: PrivateObjectStore
  database?: D1Store
}): Promise<D1UploadResult> {
  const { actor, bytes, filename, contentType } = options
  if (!CHORE_PHOTO_FILENAME_RE.test(filename)) throw new Error('Invalid chore photo filename')
  const db = options.database ?? await getD1Database()
  const bucket = options.bucket
  if (!bucket) throw new Error('Private R2 binding UPLOADS is required')
  const legacyKey = privateObjectKey(actor.familyId, 'chores', filename)
  const published = new Map<string, string>()
  const compensatePublished = async () => {
    const session = db.withSession('first-primary')
    for (const [key, generationId] of published) {
      const row = await session.prepare('SELECT id FROM "Upload" WHERE id=?1 AND family_id=?2').bind(generationId, actor.familyId).first<{ id: string }>()
      if (!row) await bucket.delete(key).catch(() => {})
    }
  }

  try {
    const session = sessionOf(db)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      // Cleanup holds this lease from metadata deletion through R2 removal.
      // Do not publish or dedupe against a row while its object is retiring.
      const leaseBeforeObject = await session.prepare(
        'SELECT id,upload_id,created_at FROM "UploadCleanupLease" WHERE family_id=?1 AND filename=?2',
      ).bind(actor.familyId, filename).first<{ id: string; upload_id: string; created_at: number }>()
      if (leaseBeforeObject) {
        // A crashed cleanup must not permanently block admission. Reclaim an
        // expired lease only after checking that no chore/list/ambient photo
        // now protects the metadata; the lease itself still serializes this
        // recovery before another same-name object can be published.
        if (Number(leaseBeforeObject.created_at) + D1_UPLOAD_LEASE_STALE_MS < Date.now()) {
          const protectedReference = await session.prepare(`SELECT 1 FROM "Upload" u
            WHERE u.family_id=?1 AND u.filename=?2 AND (
              EXISTS (SELECT 1 FROM "Chore" c WHERE c.family_id=?1 AND c.photo_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
              OR EXISTS (SELECT 1 FROM "ChoreAssignment" a WHERE a.family_id=?1 AND a.photo_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
              OR EXISTS (SELECT 1 FROM "List" l WHERE l.family_id=?1 AND l.image_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
              OR EXISTS (SELECT 1 FROM "Family" f WHERE f.id=?1 AND EXISTS (SELECT 1 FROM json_each(COALESCE(f.ambient_photo_ids,'[]')) p WHERE p.value=u.id))
            )`).bind(actor.familyId, filename).first()
          if (!protectedReference) {
            await bucket.delete(privateObjectGenerationKey(actor.familyId, 'chores', filename, leaseBeforeObject.upload_id)).catch(() => {})
            await bucket.delete(legacyKey).catch(() => {})
          }
          await session.prepare('DELETE FROM "UploadCleanupLease" WHERE id=?1 AND created_at=?2').bind(leaseBeforeObject.id, leaseBeforeObject.created_at).run()
          continue
        }
        await new Promise(resolve => setTimeout(resolve, D1_UPLOAD_LEASE_RETRY_MS))
        continue
      }
      const captured = await captureD1Reads(async read => {
        const [user, family, existing, total] = await Promise.all([
          read.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, token_version: true } }),
          read.family.findUnique({ where: { id: actor.familyId }, select: { id: true } }),
          read.upload.findUnique({ where: { filename }, select: { id: true, family_id: true, filename: true, content_type: true, size_bytes: true } }),
          read.upload.aggregate({ where: { family_id: actor.familyId }, _sum: { size_bytes: true } }),
        ])
        return { user, family, existing, total: Number(total._sum.size_bytes ?? 0) }
      }, db as unknown as NativeD1)
      const { user, family, existing, total } = captured.value
      const leaseAfterReads = await session.prepare(
        'SELECT id FROM "UploadCleanupLease" WHERE family_id=?1 AND filename=?2',
      ).bind(actor.familyId, filename).first<{ id: string }>()
      if (leaseAfterReads) {
        await new Promise(resolve => setTimeout(resolve, D1_UPLOAD_LEASE_RETRY_MS))
        continue
      }
      if (existing) {
        if (!family || !user || user.family_id !== actor.familyId || user.token_version !== actor.generation) {
          return { kind: 'gone' }
        }
        // A dedupe response is still a decision based on household/session
        // state. Re-run the captured reads at the primary commit boundary so
        // a membership/token change cannot turn a stale projection into an
        // accepted upload. This is the same witness used by the insert path;
        // the only difference is that no new row is written on a dedupe.
        try {
          await session.batch(captured.checks(session))
        } catch (cause) {
          if (isD1WriteConflict(cause)) continue
          throw cause
        }
        if (existing.family_id !== actor.familyId) {
          return { kind: 'collision' }
        }
        const generationKey = privateObjectGenerationKey(actor.familyId, 'chores', filename, existing.id)
        const generationExists = Boolean(await bucket.head(generationKey))
        const legacyExists = Boolean(await bucket.head(legacyKey))
        if (!generationExists && !legacyExists) {
          await bucket.put(generationKey, bytes, { httpMetadata: { contentType } })
          published.set(generationKey, existing.id)
        }
        try {
          await session.batch([
            session.prepare(`UPDATE "Upload" SET last_accessed_at=?1
              WHERE id=?2 AND family_id=?3
                AND NOT EXISTS (SELECT 1 FROM "UploadCleanupLease" WHERE family_id=?3 AND filename=?4)`)
              .bind(Date.now(), existing.id, actor.familyId, filename),
            d1WriteCheck(session, 'changes()=1'),
          ])
        } catch (cause) {
          if (isD1WriteConflict(cause)) continue
          throw cause
        }
        const row = { ...existing, size_bytes: Number(existing.size_bytes) } as UploadRow
        return { kind: 'ok', row, created: false }
      }
      if (!family || !user || user.family_id !== actor.familyId || user.token_version !== actor.generation) {
        return { kind: 'gone' }
      }
      if (total + bytes.byteLength > D1_FAMILY_UPLOAD_QUOTA_BYTES) {
        return { kind: 'quota' }
      }
      const id = randomUUID()
      const key = privateObjectGenerationKey(actor.familyId, 'chores', filename, id)
      if (!await bucket.head(key)) {
        await bucket.put(key, bytes, { httpMetadata: { contentType } })
        published.set(key, id)
      }
      const statements = captured.checks(session)
      statements.push(
        session.prepare(`INSERT INTO "Upload"(id,family_id,uploaded_by,filename,content_type,size_bytes)
          SELECT ?1,?2,?3,?4,?5,?6
          WHERE EXISTS (SELECT 1 FROM "Family" WHERE id=?2)
            AND EXISTS (SELECT 1 FROM "User" WHERE id=?3 AND family_id=?2 AND token_version=?7)
            AND NOT EXISTS (SELECT 1 FROM "UploadCleanupLease" WHERE family_id=?2 AND filename=?4)
            AND NOT EXISTS (SELECT 1 FROM "Upload" WHERE filename=?4)
            AND COALESCE((SELECT SUM(size_bytes) FROM "Upload" WHERE family_id=?2),0)+?6<=?8`)
          .bind(id, actor.familyId, actor.userId, filename, contentType, bytes.byteLength, actor.generation, D1_FAMILY_UPLOAD_QUOTA_BYTES),
        d1WriteCheck(session, 'changes()=1'),
      )
      try {
        await session.batch(statements)
        return {
          kind: 'ok',
          created: true,
          row: { id, family_id: actor.familyId, filename, content_type: contentType, size_bytes: bytes.byteLength },
        }
      } catch (cause) {
        if (isD1WriteConflict(cause)) {
          await compensatePublished()
          continue
        }
        throw cause
      }
    }
    throw new Error('D1 upload ownership changed; retry upload')
  } catch (error) {
    // Do not delete an object that now has a committed row. This check is the
    // recovery boundary for a failed batch and for concurrent same-content
    // upload attempts.
    await compensatePublished()
    throw error
  }
}

export async function d1UploadObjectExists(
  bucket: PrivateObjectStore,
  familyId: string,
  filename: string,
  database?: D1Store,
): Promise<boolean> {
  const row = database ? await d1GetChoreUpload(familyId, filename, database) : null
  if (row && await bucket.head(privateObjectGenerationKey(familyId, 'chores', filename, row.id))) return true
  return Boolean(await bucket.head(privateObjectKey(familyId, 'chores', filename)))
}

export async function d1GetChoreUpload(
  familyId: string,
  filename: string,
  database?: D1Store,
) {
  const db = database ?? await getD1Database()
  const read = db.withSession('first-primary')
  const row = await read.prepare(
    'SELECT id,family_id,filename,content_type,size_bytes FROM "Upload" WHERE filename=?1 AND family_id=?2',
  ).bind(filename, familyId).first<UploadRow>()
  return row ? { ...row, size_bytes: Number(row.size_bytes) } : null
}

/** Upload-row authority with the pre-D3 chore/assignment fallback retained. */
export async function canD1FamilyReadChorePhoto(
  familyId: string,
  filename: string,
  database?: D1Store,
): Promise<boolean> {
  const db = database ?? await getD1Database()
  const read = db.withSession('first-primary')
  const upload = await read.prepare(
    'SELECT family_id FROM "Upload" WHERE filename=?1',
  ).bind(filename).first<{ family_id: string }>()
  if (upload) return upload.family_id === familyId
  const path = chorePhotoPath(filename)
  // Older `/api/files/[filename]` responses stored the unscoped route in
  // `photo_url`. Keep that expand-phase reference readable after the private
  // R2 move; it still remains household-scoped by the predicates below.
  const legacyPath = `/api/files/${filename}`
  const legacy = await read.prepare(`SELECT 1 AS ok FROM "Chore"
    WHERE family_id=?1 AND (photo_url=?2 OR photo_url=?3 OR photo_url=?4) LIMIT 1`).bind(familyId, path, legacyPath, filename).first()
  if (legacy) return true
  const assignment = await read.prepare(`SELECT 1 AS ok FROM "ChoreAssignment"
    WHERE family_id=?1 AND (photo_url=?2 OR photo_url=?3 OR photo_url=?4) LIMIT 1`).bind(familyId, path, legacyPath, filename).first()
  return Boolean(assignment)
}

export type D1FileReference = { filename: string; id?: string }

/**
 * Delete stale unreferenced Upload rows and their R2 objects. Each candidate
 * is rechecked under one D1 batch witness before deletion. If object deletion
 * fails after commit the row is already gone, but the private orphan remains
 * inaccessible and can be reconciled without exposing it to another family.
 */
export async function pruneD1UnreferencedUploads(options: {
  familyId: string
  bucket: PrivateObjectStore
  now?: number
  database?: D1Store
  keepFilename?: string
}): Promise<number> {
  const db = options.database ?? await getD1Database()
  const cutoff = (options.now ?? Date.now()) - D1_STALE_UPLOAD_AGE_MS
  const session = db.withSession('first-primary')
  const candidates = await session.prepare(`SELECT u.id,u.filename FROM "Upload" u
    WHERE u.family_id=?1 AND MAX(u.created_at,u.last_accessed_at)<?2
      AND (?3 IS NULL OR u.filename<>?3)
      AND NOT EXISTS (SELECT 1 FROM "UploadCleanupLease" l WHERE l.family_id=u.family_id AND l.filename=u.filename)
      AND NOT EXISTS (SELECT 1 FROM "Chore" c WHERE c.family_id=?1 AND c.photo_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
      AND NOT EXISTS (SELECT 1 FROM "ChoreAssignment" a WHERE a.family_id=?1 AND a.photo_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
      AND NOT EXISTS (SELECT 1 FROM "List" l WHERE l.family_id=?1 AND l.image_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
      AND NOT EXISTS (SELECT 1 FROM "Family" f WHERE f.id=?1 AND EXISTS (SELECT 1 FROM json_each(COALESCE(f.ambient_photo_ids,'[]')) p WHERE p.value=u.id))
    ORDER BY u.created_at ASC,u.id ASC LIMIT ${D1_STALE_UPLOAD_BATCH}`)
    .bind(options.familyId, cutoff, options.keepFilename ?? null).all<D1FileReference>()
  if (!candidates.results.length) return 0
  let deletedCount = 0
  for (const candidate of candidates.results) {
    if (!candidate.id || !candidate.filename) continue
    const leaseId = randomUUID()
    // Claim the row before removing it. The lease is deliberately not a
    // foreign key: it must survive the metadata DELETE until the R2 object is
    // gone. Upload admission checks this tombstone before publishing/inserting
    // a replacement with the same household filename.
    const claimed = await session.batch([
      session.prepare(`INSERT INTO "UploadCleanupLease"(id,family_id,filename,upload_id,created_at)
        SELECT ?1,?2,?3,?4,?5
        WHERE EXISTS (
          SELECT 1 FROM "Upload" u
          WHERE u.id=?4 AND u.family_id=?2
            AND MAX(u.created_at,u.last_accessed_at)<?6
            AND NOT EXISTS (SELECT 1 FROM "UploadCleanupLease" l WHERE l.family_id=u.family_id AND l.filename=u.filename)
            AND NOT EXISTS (SELECT 1 FROM "Chore" c WHERE c.family_id=?2 AND c.photo_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
            AND NOT EXISTS (SELECT 1 FROM "ChoreAssignment" a WHERE a.family_id=?2 AND a.photo_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
            AND NOT EXISTS (SELECT 1 FROM "List" l WHERE l.family_id=?2 AND l.image_url IN ('/api/files/chores/'||u.filename,'/api/files/'||u.filename,u.filename))
            AND NOT EXISTS (SELECT 1 FROM "Family" f WHERE f.id=?2 AND EXISTS (SELECT 1 FROM json_each(COALESCE(f.ambient_photo_ids,'[]')) p WHERE p.value=u.id))
        )`)
        .bind(leaseId, options.familyId, candidate.filename, candidate.id, Date.now(), cutoff),
    ])
    if ((claimed[0]?.meta.changes ?? 0) !== 1) continue

    const removed = await session.batch<{ id: string; filename: string }>([
      session.prepare(`DELETE FROM "Upload"
        WHERE "Upload".id=?1 AND "Upload".family_id=?2
          AND EXISTS (SELECT 1 FROM "UploadCleanupLease" l WHERE l.id=?3 AND l.family_id="Upload".family_id AND l.filename="Upload".filename AND l.upload_id="Upload".id)
          AND NOT EXISTS (SELECT 1 FROM "Chore" c WHERE c.family_id=?2 AND c.photo_url IN ('/api/files/chores/'||"Upload".filename,'/api/files/'||"Upload".filename,"Upload".filename))
          AND NOT EXISTS (SELECT 1 FROM "ChoreAssignment" a WHERE a.family_id=?2 AND a.photo_url IN ('/api/files/chores/'||"Upload".filename,'/api/files/'||"Upload".filename,"Upload".filename))
          AND NOT EXISTS (SELECT 1 FROM "List" l WHERE l.family_id=?2 AND l.image_url IN ('/api/files/chores/'||"Upload".filename,'/api/files/'||"Upload".filename,"Upload".filename))
          AND NOT EXISTS (SELECT 1 FROM "Family" f WHERE f.id=?2 AND EXISTS (SELECT 1 FROM json_each(COALESCE(f.ambient_photo_ids,'[]')) p WHERE p.value="Upload".id))
        RETURNING "Upload".id AS id,"Upload".filename AS filename`)
        .bind(candidate.id, options.familyId, leaseId),
    ])
    const row = removed[0]?.results?.[0]
    if (!row) {
      await session.prepare('DELETE FROM "UploadCleanupLease" WHERE id=?1').bind(leaseId).run()
      continue
    }
    // The lease still blocks a same-name admission while this object is
    // removed. Release it only after R2 has completed; a failed R2 delete is
    // still recoverable because the metadata is gone and a later upload can
    // safely overwrite the family-scoped key.
    await options.bucket.delete(privateObjectGenerationKey(options.familyId, 'chores', row.filename, row.id)).catch(() => {})
    // Expand-phase rows may still have their legacy filename key. New rows
    // use immutable generation keys, so this fallback cannot touch a
    // same-filename replacement admitted after the retired row was removed.
    await options.bucket.delete(privateObjectKey(options.familyId, 'chores', row.filename)).catch(() => {})
    await session.prepare('DELETE FROM "UploadCleanupLease" WHERE id=?1').bind(leaseId).run().catch(() => {})
    deletedCount += 1
  }
  return deletedCount
}
