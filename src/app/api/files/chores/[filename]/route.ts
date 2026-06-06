import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/family-planner-uploads'
const CHORES_SUBDIR = 'chores'
const FILENAME_RE = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i

// GET /api/files/chores/[filename] — serve a chore verification photo
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  // Strict allowlist — no path separators, no '..', only known extension
  if (!FILENAME_RE.test(filename)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const filepath = path.join(UPLOAD_DIR, CHORES_SUBDIR, filename)

  // Defense in depth — ensure the resolved path is still inside UPLOAD_DIR/chores
  const resolved = path.resolve(filepath)
  const baseDir = path.resolve(UPLOAD_DIR, CHORES_SUBDIR) + path.sep
  if (!resolved.startsWith(baseDir)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  if (!existsSync(filepath)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const buf = await readFile(filepath)

  // Cache aggressively — content-addressable means it's immutable
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(filename),
      'Cache-Control': 'public, max-age=31536000, immutable',
      'ETag': `"${crypto.createHash('md5').update(buf).digest('hex')}"`,
    },
  })
}

function contentTypeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'heic':
      return 'image/heic'
    default:
      return 'application/octet-stream'
  }
}