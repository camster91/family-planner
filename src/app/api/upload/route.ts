import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { authenticateWithFamily } from '@/lib/api-auth'
import { log } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // Need full Node for fs

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/family-planner-uploads'

// POST /api/upload — upload a photo (used for chore completion verification)
// Body: multipart/form-data with a 'file' field
// Returns: { url: string, filename: string, size: number, type: string }
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    // Validate type
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Allowed: ${[...ALLOWED_TYPES].join(', ')}` },
        { status: 400 }
      )
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Ensure upload dir exists
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    }

    // Generate unique filename — content-addressable for dedup
    const buf = Buffer.from(await file.arrayBuffer())
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const ext = file.type.split('/')[1] || 'bin'
    const filename = `${hash}.${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)

    // Only write if not already there (dedup)
    if (!existsSync(filepath)) {
      await writeFile(filepath, buf)
    }

    log.info('upload.photo', { userId: auth.user.id, filename, size: buf.length, type: file.type })

    return NextResponse.json({
      url: `/api/files/${filename}`,
      filename,
      size: buf.length,
      type: file.type,
    })
  } catch (error) {
    log.error('upload.photo', error as Error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
