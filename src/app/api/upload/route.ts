import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir, rename, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { authenticateWithFamily } from '@/lib/api-auth'
import { log } from '@/lib/logger'
import { sniffImageType } from '@/lib/image-sniff'
import { prisma } from '@/lib/prisma'
import { chorePhotoPath } from '@/lib/chore-photos'
import { lockHouseholdForJoin } from '@/lib/household-lock'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
// GIF is deliberately absent: /api/files/chores only serves jpg/png/webp/heic.
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/family-planner-uploads'

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

    const formData = await request.formData()
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

    // Order against household deletion (D-3, src/lib/household-lock.ts):
    // 1. the bytes are written to a private temp file first;
    // 2. then, in one transaction under the household lock, the household is
    //    re-checked, the temp file is moved to its final name only if no file
    //    is there yet, and the ownership row is written. The lock also
    //    serialises same-household uploads of the same image, so only the
    //    request that moved the file into place may remove it again, and it
    //    does so while still holding the lock if the row insert fails;
    // 3. the temp file is always removed (finally), so no unowned copy is left.
    // A deletion that ran first makes this upload refuse; one that runs after
    // sees the Upload row with its file already on disk and removes both.
    const tmp = `${filepath}.${crypto.randomUUID()}.tmp`
    await writeFile(tmp, buf)

    // A re-upload in the same family reuses the existing row. A row owned by
    // another family would mean a 64-bit hash collision across households:
    // refuse rather than hand over or share the file.
    let outcome: 'ok' | 'gone' | 'collision'
    try {
      outcome = await prisma!.$transaction(async (tx) => {
        if (!(await lockHouseholdForJoin(tx, familyId))) return 'gone' as const
        const existing = await tx.upload.findUnique({ where: { filename }, select: { family_id: true } })
        if (existing && existing.family_id !== familyId) return 'collision' as const
        let placed = false
        if (!existsSync(filepath)) {
          await rename(tmp, filepath)
          placed = true
        }
        if (!existing) {
          try {
            await tx.upload.create({
              data: {
                family_id: familyId,
                uploaded_by: auth.user.id,
                filename,
                content_type: sniffed.mime,
                size_bytes: buf.length,
              },
            })
          } catch (err) {
            if (placed) await unlink(filepath).catch(() => {})
            throw err
          }
        }
        return 'ok' as const
      })
    } finally {
      await unlink(tmp).catch(() => {})
    }
    if (outcome === 'gone') {
      return NextResponse.json({ error: 'Household not found' }, { status: 404 })
    }
    if (outcome === 'collision') {
      log.warn('upload.photo.collision', { userId: auth.user.id, filename })
      return NextResponse.json({ error: 'Upload failed, please try again' }, { status: 409 })
    }

    log.info('upload.photo', { userId: auth.user.id, filename, size: buf.length, type: sniffed.mime })

    return NextResponse.json({
      url: chorePhotoPath(filename),
      filename,
      size: buf.length,
      type: sniffed.mime,
    })
  } catch (error) {
    log.error('upload.photo', error as Error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
