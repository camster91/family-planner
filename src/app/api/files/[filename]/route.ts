import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { authenticateRequest } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/family-planner-uploads'
const FILENAME_RE = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i

// GET /api/files/[filename] — serve an uploaded photo
// Files are content-addressable (sha256 prefix + extension), but an
// unguessable name is not an access control — URLs leak via screenshots,
// logs and shared caches. Require a session and never let shared caches keep
// the bytes. We still validate the filename shape to prevent path traversal.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  // Strict allowlist — no path separators, no '..', only known extension
  if (!FILENAME_RE.test(filename)) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Authenticate before touching the filesystem, so an unauthenticated caller
  // learns nothing — not even whether the file exists.
  const [, authError] = await authenticateRequest(request)
  if (authError) return authError

  const filepath = path.join(UPLOAD_DIR, filename)

  // Defense in depth — even if regex passed, ensure the resolved path
  // is still inside UPLOAD_DIR
  const resolved = path.resolve(filepath)
  if (!resolved.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  if (!existsSync(filepath)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const buf = await readFile(filepath)

  // Private: shared/intermediary caches must not retain user photos. The
  // content hash still makes a short-lived browser cache safe.
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(filename),
      'Cache-Control': 'private, max-age=300',
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
