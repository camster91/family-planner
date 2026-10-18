import crypto from 'crypto'
import { existsSync } from 'fs'
import { mkdir, rename, unlink } from 'fs/promises'
import path from 'path'
import { lockHousehold, lockHouseholdForJoin } from '@/lib/household-lock'
import { resolveUploadDir } from '@/lib/upload-dir'

/** Message files never share the chore-photo directory or URL contract. */
export const MESSAGE_ATTACHMENT_PATH_PREFIX = '/api/messages/attachments/'
export const MESSAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
// A single upload has one file plus bounded multipart field/header overhead.
// The route rejects explicit invalid/oversized Content-Length values and
// applies this same cap while reading the body when browser FormData omits the
// header, keeping ordinary multipart clients within the 5 MiB file contract.
export const MESSAGE_ATTACHMENT_MAX_REQUEST_BYTES = MESSAGE_ATTACHMENT_MAX_BYTES + 1024 * 1024
export const MESSAGE_ATTACHMENT_STALE_AGE_MS = 24 * 60 * 60 * 1000
export const MESSAGE_ATTACHMENT_STALE_BATCH = 20
export const MESSAGE_ATTACHMENT_FILENAME_RE =
  /^[a-f0-9]{32}\.(jpg|png|webp|heic)$/i

export type MessageAttachmentMime =
  'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic'

export function messageAttachmentPath(id: string): string {
  return `${MESSAGE_ATTACHMENT_PATH_PREFIX}${encodeURIComponent(id)}`
}

export function messageAttachmentDir(uploadDir = resolveUploadDir()): string {
  return path.join(uploadDir, 'messages')
}

export function messageAttachmentFilename(
  familyId: string,
  bytes: Uint8Array,
  ext: string,
): string {
  return `${crypto.createHash('sha256').update(`family:${familyId}\nmessage\n`).update(bytes).digest('hex').slice(0, 32)}.${ext}`
}

/**
 * A fresh filename is needed when a content-identical upload is already
 * claimed, or belongs to another uploader's draft. The content digest remains
 * part of the name for useful locality, while the nonce prevents one row and
 * one file from being handed to two message intents.
 */
function freshMessageAttachmentFilename(
  familyId: string,
  bytes: Uint8Array,
  ext: string,
): string {
  return `${crypto
    .createHash('sha256')
    .update(`family:${familyId}\nmessage\n${crypto.randomUUID()}\n`)
    .update(bytes)
    .digest('hex')
    .slice(0, 32)}.${ext}`
}

export function messageAttachmentFilePath(
  filename: string,
  uploadDir = resolveUploadDir(),
): string {
  if (!MESSAGE_ATTACHMENT_FILENAME_RE.test(filename))
    throw new Error('Invalid message attachment filename')
  const root = path.resolve(messageAttachmentDir(uploadDir))
  const resolved = path.resolve(root, filename)
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error('Invalid message attachment path')
  return resolved
}

export type StoredMessageAttachment = {
  id: string
  filename: string
  content_type: MessageAttachmentMime
  size_bytes: number
}

/**
 * Persist a message image and its household ownership row. The caller must
 * authenticate and feature-gate before calling this helper.
 */
export async function storeMessageAttachment(
  db: any,
  familyId: string,
  userId: string,
  bytes: Uint8Array,
  contentType: MessageAttachmentMime,
  ext: string,
  uploadDir = resolveUploadDir(),
): Promise<StoredMessageAttachment> {
  if (bytes.byteLength > MESSAGE_ATTACHMENT_MAX_BYTES)
    throw new Error('MESSAGE_ATTACHMENT_TOO_LARGE')
  const dir = messageAttachmentDir(uploadDir)
  await mkdir(dir, { recursive: true })
  let filename = messageAttachmentFilename(familyId, bytes, ext)
  let created = false
  let row: StoredMessageAttachment
  let createdAttachment: StoredMessageAttachment | undefined
  let tmp: string | undefined
  let filepath: string | undefined
  let placed = false
  try {
    row = await db.$transaction(async (tx: any) => {
      if (!(await lockHouseholdForJoin(tx, familyId)))
        throw new Error('MESSAGE_FAMILY_NOT_FOUND')
      let existing = await tx.messageAttachment.findUnique({
        where: { filename },
        select: {
          id: true,
          family_id: true,
          uploaded_by: true,
          message_id: true,
          filename: true,
          content_type: true,
          size_bytes: true,
        },
      })
      if (existing) {
        if (existing.family_id !== familyId)
          throw new Error('MESSAGE_ATTACHMENT_COLLISION')
        // Reusing an unclaimed draft is safe only for the uploader who owns
        // the pending intent. A claimed row, or another member's draft, gets
        // a new row and file even when the bytes are identical.
        if (existing.message_id == null && existing.uploaded_by === userId)
          return existing

        let available = false
        for (let attempt = 0; attempt < 8; attempt += 1) {
          filename = freshMessageAttachmentFilename(familyId, bytes, ext)
          existing = await tx.messageAttachment.findUnique({
            where: { filename },
            select: { id: true, family_id: true },
          })
          if (!existing) {
            available = true
            break
          }
          if (existing.family_id !== familyId)
            throw new Error('MESSAGE_ATTACHMENT_COLLISION')
        }
        if (!available) throw new Error('MESSAGE_ATTACHMENT_COLLISION')
      }
      created = true
      return tx.messageAttachment.create({
        data: {
          family_id: familyId,
          uploaded_by: userId,
          filename,
          content_type: contentType,
          size_bytes: bytes.byteLength,
        },
        select: {
          id: true,
          family_id: true,
          filename: true,
          content_type: true,
          size_bytes: true,
        },
      })
    })

    if (created) createdAttachment = row
    filepath = messageAttachmentFilePath(filename, uploadDir)
    const tempPath = `${filepath}.${crypto.randomUUID()}.tmp`
    tmp = tempPath
    await import('fs/promises').then(({ writeFile }) => writeFile(tempPath, bytes))
    placed = !existsSync(filepath)
    if (placed) {
      await rename(tempPath, filepath)
    }
    const still = await db.messageAttachment.findUnique({
      where: { filename },
      select: { family_id: true },
    })
    if (!still || still.family_id !== familyId) {
      throw new Error('MESSAGE_FAMILY_NOT_FOUND')
    }
    return {
      id: row.id,
      filename: row.filename,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
    }
  } catch (error) {
    const attachment = createdAttachment
    if (attachment) {
      let removed = { count: 0 }
      try {
        removed = await db.$transaction(async (tx: any) => {
          // Message sends take this same lock before reading and claiming a
          // draft. Wait for an in-flight claim before deciding whether this
          // exact row is still safe to remove.
          await lockHousehold(tx, familyId)
          return tx.messageAttachment.deleteMany({
            where: {
              id: attachment.id,
              family_id: familyId,
              uploaded_by: userId,
              message_id: null,
            },
          })
        })
      } catch {
        // Cleanup is fail-safe: retain the row and final file if the guarded
        // delete cannot be completed or verified.
        removed = { count: 0 }
      }
      // A concurrent sender may have claimed the row while file placement or
      // the post-rename verification was failing. Only unlink a final file
      // when this exact unclaimed row was removed; a claimed attachment owns
      // the file for its message and must remain intact.
      if (removed.count > 0 && placed && filepath) {
        await unlink(filepath).catch(() => {})
      }
    }
    throw error
  } finally {
    if (tmp) await unlink(tmp).catch(() => {})
  }
}

/** Remove only unclaimed draft message attachments for one household. */
export async function pruneUnboundMessageAttachments(
  db: any,
  familyId: string,
  options: { uploadDir?: string; now?: number } = {},
): Promise<number> {
  const cutoff = new Date(
    (options.now ?? Date.now()) - MESSAGE_ATTACHMENT_STALE_AGE_MS,
  )
  try {
    const removed = await db.$transaction(async (tx: any) => {
      await lockHousehold(tx, familyId)
      // Read candidates after the same household lock used by message sends;
      // otherwise a concurrent send could claim a pre-read row while cleanup
      // still unlinks its live file.
      const candidates = await tx.messageAttachment.findMany({
        where: {
          family_id: familyId,
          message_id: null,
          created_at: { lt: cutoff },
        },
        select: { id: true, filename: true },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: MESSAGE_ATTACHMENT_STALE_BATCH,
      })
      if (candidates.length === 0) return []
      await tx.messageAttachment.deleteMany({
        where: {
          id: { in: candidates.map((item: { id: string }) => item.id) },
          family_id: familyId,
          message_id: null,
          created_at: { lt: cutoff },
        },
      })
      return candidates
    })
    for (const item of removed) {
      await unlink(
        messageAttachmentFilePath(item.filename, options.uploadDir),
      ).catch(() => {})
    }
    return removed.length
  } catch {
    // Housekeeping never makes the user's upload fail.
    return 0
  }
}
