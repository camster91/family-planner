import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, rename, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { authenticateWithFamily } from '@/lib/api-auth'
import { log } from '@/lib/logger'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { sniffImageType } from '@/lib/image-sniff'
import { prisma } from '@/lib/prisma'
import { chorePhotoPath } from '@/lib/chore-photos'
import { lockHouseholdForJoin } from '@/lib/household-lock'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { resolveUploadDir } from '@/lib/upload-dir'
import {
  FAMILY_UPLOAD_QUOTA_BYTES,
  FAMILY_UPLOAD_QUOTA_MESSAGE,
  UPLOAD_RATE_LIMIT_MAX,
  UPLOAD_RATE_LIMIT_WINDOW_MS,
  familyUploadBytes,
  pruneUnreferencedUploads,
} from '@/lib/upload-housekeeping'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
// One photo plus generous room for multipart framing and other fields.
const MAX_REQUEST_BYTES = MAX_FILE_SIZE + 1024 * 1024
// GIF is deliberately absent: /api/files/chores only serves jpg/png/webp/heic.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const UPLOAD_DIR = resolveUploadDir()

// POST /api/upload — upload a photo (used for chore completion verification)
// Body: multipart/form-data with a 'file' field
// Returns: { url: string, filename: string, size: number, type: string }
//
// Ownership (D3, #102): every stored file gets an `Upload` row recording the
// caller's family and the uploader. That row is what lets the file be attached
// to a chore (/api/chores create/update/complete) and served back
// (/api/files/chores/[filename]) — and only inside that family.
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const rate = await checkRateLimit(`upload:${auth.user.id}`, UPLOAD_RATE_LIMIT_MAX, UPLOAD_RATE_LIMIT_WINDOW_MS)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many photo uploads this hour. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) } }
      )
    }

    // Refuse a body far larger than one allowed photo before buffering it.
    const declaredLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 413 }
      )
    }

    // A body that is not multipart (or urlencoded) form data makes formData()
    // throw: that is the client's mistake, not a server error.
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      return NextResponse.json({ error: 'Send the photo as multipart/form-data with a "file" field' }, { status: 400 })
    }
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Ensure upload dir exists
    const choreUploadDir = path.join(UPLOAD_DIR, 'chores')
    if (!existsSync(choreUploadDir)) {
      await mkdir(choreUploadDir, { recursive: true })
    }

    const buf = Buffer.from(await file.arrayBuffer())

    // Validate type from the file's magic bytes, not the client-declared MIME
    // (which is attacker-controlled). The extension is derived from the
    // sniffed type so the stored file is always served as what it really is.
    const sniffed = sniffImageType(buf)
    if (!sniffed || !ALLOWED_TYPES.has(sniffed.mime)) {
      return NextResponse.json(
        { error: `Unsupported file type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` },
        { status: 400 }
      )
    }

    // Content-addressed per family: sha256(family_id, bytes) prefix + sniffed
    // extension. Namespacing by family means two households uploading the
    // same image get different files and different Upload rows (filename is
    // unique), and a filename reveals nothing about another family's files.
    // Re-uploading the same image in the same family still dedups.
    const crypto = await import('crypto')
    const { createHash } = crypto
    const familyId = auth.user.family_id
    const hash = createHash('sha256')
      .update(`family:${familyId}\n`)
      .update(buf)
      .digest('hex')
      .slice(0, 16)
    const ext = sniffed.ext
    const filename = `${hash}.${ext}`
    const filepath = path.join(choreUploadDir, filename)

    // Opportunistic cleanup of this household's stale, unreferenced uploads
    // (src/lib/upload-housekeeping.ts). It runs before the quota check so a
    // household at its quota can recover by uploading again; it never fails
    // the upload and never touches the file this request is storing.
    await pruneUnreferencedUploads(prisma!, familyId, { uploadDir: UPLOAD_DIR, keepFilename: filename })

    // Order against household deletion (D-3, src/lib/household-lock.ts):
    // 1. the bytes are written to a private temp file;
    // 2. one transaction under the household lock re-checks the household and
    //    writes the ownership row (a same-household re-upload reuses its row);
    // 3. only after that commits is the temp file moved to its final name, so
    //    a failed transaction or commit never leaves a final file behind;
    // 4. the row is read again: if a household deletion removed it in the
    //    meantime (it deletes files after its own commit, so it may have run
    //    before the move), this request removes the file it just placed;
    // 5. the temp file is always removed (finally).
    // Identical bytes map to the same name, so a concurrent same-household
    // upload moving the same content into place is harmless.
    const tmp = `${filepath}.${crypto.randomUUID()}.tmp`
    await writeFile(tmp, buf)

    // A row owned by another family would mean a 64-bit hash collision across
    // households: refuse rather than hand over or share the file.
    let outcome: 'ok' | 'gone' | 'collision' | 'quota'
    let created = false
    try {
      outcome = await prisma!.$transaction(async (tx) => {
        if (!(await lockHouseholdForJoin(tx, familyId))) return 'gone' as const
        const existing = await tx.upload.findUnique({ where: { filename }, select: { family_id: true } })
        if (existing && existing.family_id !== familyId) return 'collision' as const
        // Quota under the household lock, so concurrent uploads cannot both
        // squeeze past it. A same-household re-upload stores nothing new.
        if (!existing && (await familyUploadBytes(tx, familyId)) + buf.length > FAMILY_UPLOAD_QUOTA_BYTES) {
          return 'quota' as const
        }
        if (!existing) {
          await tx.upload.create({
            data: {
              family_id: familyId,
              uploaded_by: auth.user.id,
              filename,
              content_type: sniffed.mime,
              size_bytes: buf.length,
            },
          })
          created = true
        }
        return 'ok' as const
      })
      if (outcome === 'ok') {
        const placed = !existsSync(filepath)
        if (placed) {
          try {
            await rename(tmp, filepath)
          } catch (err) {
            // No file behind the row: take back the row this request created.
            if (created) await prisma!.upload.deleteMany({ where: { filename, family_id: familyId } }).catch(() => {})
            throw err
          }
        }
        const still = await prisma!.upload.findUnique({ where: { filename }, select: { family_id: true } })
        if (!still || still.family_id !== familyId) {
          if (placed) await unlink(filepath).catch(() => {})
          outcome = 'gone'
        }
      }
    } finally {
      await unlink(tmp).catch(() => {})
    }
    if (outcome === 'gone') {
      return NextResponse.json({ error: 'Household not found' }, { status: 404 })
    }
    if (outcome === 'quota') {
      log.warn('upload.photo.quota_exceeded')
      return NextResponse.json({ error: FAMILY_UPLOAD_QUOTA_MESSAGE }, { status: 413 })
    }
    if (outcome === 'collision') {
      log.warn('upload.photo.collision')
      return NextResponse.json({ error: 'Upload failed, please try again' }, { status: 409 })
    }

    log.info('upload.photo', { size: buf.length, type: sniffed.mime })

    return NextResponse.json({
      url: chorePhotoPath(filename),
      filename,
      size: buf.length,
      type: sniffed.mime,
    })
  } catch (error) {
    logRouteError('POST /api/upload', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
