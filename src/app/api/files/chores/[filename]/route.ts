import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { authenticateWithFamily } from '@/lib/api-auth'
import { CHORE_PHOTO_FILENAME_RE, canFamilyReadChorePhoto } from '@/lib/chore-photos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/family-planner-uploads'
const CHORES_SUBDIR = 'chores'
const FILENAME_RE = CHORE_PHOTO_FILENAME_RE

// GET /api/files/chores/[filename] — serve a chore verification photo
//
// These are photographs of children. They were previously served to anyone who
// held the URL, with no session and no family scoping, and cached `public,
// immutable` for a year. The unguessable filename was the only protection, and
// it is not a privacy control: a URL survives in a screenshot, a forwarded
// message, browser sync, a log line, or a proxy cache.
//
// Now: authenticated callers only, and only the family that owns the photo.
//
// Ownership (D3, #102): an `Upload` row, written by POST /api/upload, records
// the owning family of every file stored since D3, and is authoritative when
// present. Files stored earlier have no row; for those (legacy, expand phase)
// ownership is resolved through a chore or chore assignment of the caller's
// family that references the file. See canFamilyReadChorePhoto and
// docs/security/API_ISOLATION_AUDIT.md (D3) for the planned contract step. A
// file that neither path assigns to the caller's family is not served at all.
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
  const [auth, authError] = await authenticateWithFamily(request)
  if (authError) return authError

  const filepath = path.join(UPLOAD_DIR, CHORES_SUBDIR, filename)

  // Defense in depth — ensure the resolved path is still inside UPLOAD_DIR/chores
  const resolved = path.resolve(filepath)
  const baseDir = path.resolve(UPLOAD_DIR, CHORES_SUBDIR) + path.sep
  if (!resolved.startsWith(baseDir)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Cross-family and unowned files get the same 404 as a missing file, so the
  // response does not confirm that a file exists in another household.
  if (!(await canFamilyReadChorePhoto(auth.user.family_id, filename))) {
    return new NextResponse('Not found', { status: 404 })
  }

  if (!existsSync(filepath)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const buf = await readFile(filepath)

  // Private, not public. These are children's photographs: shared and
  // intermediary caches must not retain them, and `immutable` told clients never
  // to revalidate — both removed. The content hash still makes a short-lived
  // browser cache safe.
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
