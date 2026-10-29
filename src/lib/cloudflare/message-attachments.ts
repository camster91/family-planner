import { createHash, randomUUID } from 'node:crypto'
import type { D1Store } from './database'
import { getD1Database } from './database'
import { captureD1Reads } from './read-witness'
import type { NativeD1 } from './read-client'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { privateObjectGenerationKey, privateObjectKey, type PrivateObjectStore } from './storage'

export const D1_MESSAGE_ATTACHMENT_STALE_AGE_MS = 24 * 60 * 60 * 1000
export const D1_MESSAGE_ATTACHMENT_STALE_BATCH = 20
const FILENAME_RE = /^[a-f0-9]{32}\.(jpg|png|webp|heic)$/i
const D1_ATTACHMENT_LEASE_RETRY_MS = 5
const D1_ATTACHMENT_LEASE_STALE_MS = 5 * 60 * 1000

export type D1MessageAttachmentRow = {
  id: string
  family_id: string
  uploaded_by: string | null
  message_id?: string | null
  filename: string
  content_type: string
  size_bytes: number
}

function contentFilename(familyId: string, bytes: Uint8Array, ext: string, nonce?: string) {
  return `${createHash('sha256').update(`family:${familyId}\nmessage\n${nonce ?? ''}`).update(bytes).digest('hex').slice(0, 32)}.${ext}`
}

/** Store one private message attachment and its D1 draft row. */
export async function storeD1MessageAttachment(options: {
  familyId: string
  userId: string
  generation: number
  bytes: Uint8Array
  contentType: string
  ext: string
  bucket?: PrivateObjectStore
  database?: D1Store
  filename?: string
}): Promise<D1MessageAttachmentRow> {
  const db = options.database ?? await getD1Database()
  const bucket = options.bucket
  if (!bucket) throw new Error('Private R2 binding UPLOADS is required')
  if (options.bytes.byteLength > 5 * 1024 * 1024) throw new Error('MESSAGE_ATTACHMENT_TOO_LARGE')
  let filename = options.filename ?? contentFilename(options.familyId, options.bytes, options.ext)
  if (!FILENAME_RE.test(filename)) throw new Error('Invalid message attachment filename')
  const published = new Set<string>()
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const session = db.withSession('first-primary')
      const leaseBeforeObject = await session.prepare(
        'SELECT id,attachment_id,created_at FROM "MessageAttachmentCleanupLease" WHERE family_id=?1 AND filename=?2',
      ).bind(options.familyId, filename).first<{ id: string; attachment_id: string; created_at: number }>()
      if (leaseBeforeObject) {
        // Recover a lease left by a crashed cleanup only after confirming the
        // attachment is still an unclaimed draft. Claimed message media is
        // never deleted during lease recovery.
        if (Number(leaseBeforeObject.created_at) + D1_ATTACHMENT_LEASE_STALE_MS < Date.now()) {
          const claimed = await session.prepare(`SELECT 1 FROM "MessageAttachment"
            WHERE family_id=?1 AND filename=?2 AND message_id IS NOT NULL`).bind(options.familyId, filename).first()
          if (!claimed) {
            await bucket.delete(privateObjectGenerationKey(options.familyId, 'messages', filename, leaseBeforeObject.attachment_id)).catch(() => {})
            await bucket.delete(privateObjectKey(options.familyId, 'messages', filename)).catch(() => {})
          }
          await session.prepare('DELETE FROM "MessageAttachmentCleanupLease" WHERE id=?1 AND created_at=?2').bind(leaseBeforeObject.id, leaseBeforeObject.created_at).run()
          continue
        }
        await new Promise(resolve => setTimeout(resolve, D1_ATTACHMENT_LEASE_RETRY_MS))
        continue
      }
      const captured = await captureD1Reads(async read => {
        const [user, existing] = await Promise.all([
          read.user.findUnique({ where: { id: options.userId }, select: { family_id: true, token_version: true } }),
          read.messageAttachment.findUnique({ where: { filename }, select: { id: true, family_id: true, uploaded_by: true, message_id: true, filename: true, content_type: true, size_bytes: true } }),
        ])
        return { user, existing }
      }, db as unknown as NativeD1)
      const { user, existing } = captured.value
      if (!user || user.family_id !== options.familyId || user.token_version !== options.generation) throw new Error('MESSAGE_FAMILY_NOT_FOUND')
      const leaseAfterReads = await session.prepare(
        'SELECT id FROM "MessageAttachmentCleanupLease" WHERE family_id=?1 AND filename=?2',
      ).bind(options.familyId, filename).first<{ id: string }>()
      if (leaseAfterReads) {
        await new Promise(resolve => setTimeout(resolve, D1_ATTACHMENT_LEASE_RETRY_MS))
        continue
      }
      if (existing) {
        if (existing.family_id !== options.familyId) throw new Error('MESSAGE_ATTACHMENT_COLLISION')
        if (existing.message_id == null && existing.uploaded_by === options.userId) {
          const generationKey = privateObjectGenerationKey(options.familyId, 'messages', filename, existing.id)
          const legacyKey = privateObjectKey(options.familyId, 'messages', filename)
          if (!await bucket.head(generationKey) && !await bucket.head(legacyKey)) {
            await bucket.put(generationKey, options.bytes, { httpMetadata: { contentType: options.contentType } })
            published.add(generationKey)
          }
          try {
            await session.batch([
              ...captured.checks(session),
              session.prepare(`UPDATE "MessageAttachment" SET last_accessed_at=?1
                WHERE id=?2 AND family_id=?3 AND message_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM "MessageAttachmentCleanupLease" WHERE family_id=?3 AND filename=?4)`)
                .bind(Date.now(), existing.id, options.familyId, filename),
              d1WriteCheck(session, 'changes()=1'),
            ])
          } catch (cause) {
            if (isD1WriteConflict(cause)) continue
            throw cause
          }
          return { ...existing, size_bytes: Number(existing.size_bytes) } as D1MessageAttachmentRow
        }
        filename = contentFilename(options.familyId, options.bytes, options.ext, randomUUID())
        continue
      }
      const id = randomUUID()
      const key = privateObjectGenerationKey(options.familyId, 'messages', filename, id)
      if (!await bucket.head(key)) {
        await bucket.put(key, options.bytes, { httpMetadata: { contentType: options.contentType } })
        published.add(key)
      }
      try {
        await session.batch([
          ...captured.checks(session),
          session.prepare(`INSERT INTO "MessageAttachment"(id,family_id,uploaded_by,message_id,filename,content_type,size_bytes)
            SELECT ?1,?2,?3,NULL,?4,?5,?6
            WHERE EXISTS (SELECT 1 FROM "User" WHERE id=?3 AND family_id=?2 AND token_version=?7)
              AND NOT EXISTS (SELECT 1 FROM "MessageAttachmentCleanupLease" WHERE family_id=?2 AND filename=?4)
              AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" WHERE filename=?4)`)
            .bind(id, options.familyId, options.userId, filename, options.contentType, options.bytes.byteLength, options.generation),
          d1WriteCheck(session, 'changes()=1'),
        ])
        return { id, family_id: options.familyId, uploaded_by: options.userId, message_id: null, filename, content_type: options.contentType, size_bytes: options.bytes.byteLength }
      } catch (cause) {
        if (isD1WriteConflict(cause)) {
          if (published.has(key)) {
            await bucket.delete(key).catch(() => {})
            published.delete(key)
          }
          filename = contentFilename(options.familyId, options.bytes, options.ext, randomUUID())
          continue
        }
        throw cause
      }
    }
    throw new Error('Message attachment ownership changed; retry upload')
  } catch (error) {
    for (const key of published) {
      const row = await db.withSession('first-primary').prepare('SELECT family_id FROM "MessageAttachment" WHERE filename=?1 AND family_id=?2').bind(key.split('/').pop() ?? '', options.familyId).first<{ family_id: string }>()
      if (!row) await bucket.delete(key).catch(() => {})
    }
    throw error
  }
}

export async function pruneD1MessageAttachments(options: {
  familyId: string
  bucket: PrivateObjectStore
  now?: number
  database?: D1Store
}): Promise<number> {
  const db = options.database ?? await getD1Database()
  const cutoff = (options.now ?? Date.now()) - D1_MESSAGE_ATTACHMENT_STALE_AGE_MS
  const session = db.withSession('first-primary')
  const candidates = await session.prepare(`SELECT id,filename FROM "MessageAttachment"
    WHERE family_id=?1 AND message_id IS NULL AND MAX(created_at,last_accessed_at)<?2
      AND NOT EXISTS (SELECT 1 FROM "MessageAttachmentCleanupLease" l WHERE l.family_id="MessageAttachment".family_id AND l.filename="MessageAttachment".filename)
    ORDER BY created_at ASC,id ASC LIMIT ${D1_MESSAGE_ATTACHMENT_STALE_BATCH}`)
    .bind(options.familyId, cutoff).all<{ id: string; filename: string }>()
  if (!candidates.results.length) return 0
  let deletedCount = 0
  for (const candidate of candidates.results) {
    if (!candidate.id || !candidate.filename) continue
    const leaseId = randomUUID()
    const claimed = await session.batch([
      session.prepare(`INSERT INTO "MessageAttachmentCleanupLease"(id,family_id,filename,attachment_id,created_at)
        SELECT ?1,?2,?3,?4,?5
        WHERE EXISTS (
          SELECT 1 FROM "MessageAttachment" a
          WHERE a.id=?4 AND a.family_id=?2 AND a.message_id IS NULL
            AND MAX(a.created_at,a.last_accessed_at)<?6
            AND NOT EXISTS (SELECT 1 FROM "MessageAttachmentCleanupLease" l WHERE l.family_id=a.family_id AND l.filename=a.filename)
        )`)
        .bind(leaseId, options.familyId, candidate.filename, candidate.id, Date.now(), cutoff),
    ])
    if ((claimed[0]?.meta.changes ?? 0) !== 1) continue
    const removed = await session.batch<{ id: string; filename: string }>([
      session.prepare(`DELETE FROM "MessageAttachment"
        WHERE "MessageAttachment".id=?1 AND "MessageAttachment".family_id=?2
          AND "MessageAttachment".message_id IS NULL
          AND EXISTS (SELECT 1 FROM "MessageAttachmentCleanupLease" l WHERE l.id=?3 AND l.family_id="MessageAttachment".family_id AND l.filename="MessageAttachment".filename AND l.attachment_id="MessageAttachment".id)
        RETURNING "MessageAttachment".id AS id,"MessageAttachment".filename AS filename`)
        .bind(candidate.id, options.familyId, leaseId),
    ])
    const row = removed[0]?.results?.[0]
    if (!row) {
      await session.prepare('DELETE FROM "MessageAttachmentCleanupLease" WHERE id=?1').bind(leaseId).run()
      continue
    }
    if (FILENAME_RE.test(row.filename)) {
      await options.bucket.delete(privateObjectGenerationKey(options.familyId, 'messages', row.filename, row.id)).catch(() => {})
      // Expand-phase rows may still have their legacy filename key. New rows
      // use immutable generation keys, so an old cleanup cannot delete a
      // replacement admitted under the same filename.
      await options.bucket.delete(privateObjectKey(options.familyId, 'messages', row.filename)).catch(() => {})
    }
    await session.prepare('DELETE FROM "MessageAttachmentCleanupLease" WHERE id=?1').bind(leaseId).run().catch(() => {})
    deletedCount += 1
  }
  return deletedCount
}

export async function getD1MessageAttachment(
  familyId: string,
  id: string,
  database?: D1Store,
): Promise<D1MessageAttachmentRow | null> {
  const db = database ?? await getD1Database()
  const row = await db.withSession('first-primary').prepare(`SELECT id,family_id,filename,content_type,size_bytes
    FROM "MessageAttachment" WHERE id=?1 AND family_id=?2 AND message_id IS NOT NULL`).bind(id, familyId).first<D1MessageAttachmentRow>()
  return row ? { ...row, size_bytes: Number(row.size_bytes) } : null
}
