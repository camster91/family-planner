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
  const filename = messageAttachmentFilename(familyId, bytes, ext)
  const filepath = messageAttachmentFilePath(filename, uploadDir)
  const tmp = `${filepath}.${crypto.randomUUID()}.tmp`
  await import('fs/promises').then(({ writeFile }) => writeFile(tmp, bytes))

  let created = false
  try {
    const row = await db.$transaction(async (tx: any) => {
      if (!(await lockHouseholdForJoin(tx, familyId)))
        throw new Error('MESSAGE_FAMILY_NOT_FOUND')
      const existing = await tx.messageAttachment.findUnique({
        where: { filename },
        select: {
          id: true,
          family_id: true,
          filename: true,
          content_type: true,
          size_bytes: true,
        },
      })
      if (existing) {
        if (existing.family_id !== familyId)
          throw new Error('MESSAGE_ATTACHMENT_COLLISION')
        return existing
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

    const placed = !existsSync(filepath)
    if (placed) {
      try {
        await rename(tmp, filepath)
      } catch (error) {
        if (created) {
          await db.messageAttachment
            .deleteMany({ where: { filename, family_id: familyId } })
            .catch(() => {})
        }
        throw error
      }
    }
    const still = await db.messageAttachment.findUnique({
      where: { filename },
      select: { family_id: true },
    })
    if (!still || still.family_id !== familyId) {
      if (placed) await unlink(filepath).catch(() => {})
      throw new Error('MESSAGE_FAMILY_NOT_FOUND')
    }
    return {
      id: row.id,
      filename: row.filename,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
    }
  } finally {
    await unlink(tmp).catch(() => {})
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
