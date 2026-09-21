import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import crypto from 'crypto'
import { authenticateWithFamily } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/family-planner-uploads'
const CHORES_SUBDIR = 'chores'
const FILENAME_RE = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|heic)$/i

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
// Ownership is resolved through the chore that references the photo rather than
// a stored family_id column. That needs no schema change — which matters while
// the migration path is unproven — and it cannot disagree with the chore it is
// attached to. A file no chore references is not served at all.
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

  // Resolve ownership: which family does a chore referencing this photo belong
  // to? `photo_url` is stored as the full `/api/files/chores/<name>` path, so
  // match on that suffix. `endsWith` is exact enough here — the filename is a
  // content hash, and the stored value is either the path form or the bare name.
  const publicPath = `/api/files/chores/${filename}`
  const chore = await prisma!.chore.findFirst({
    where: {
      OR: [{ photo_url: publicPath }, { photo_url: filename }],
    },
    select: { family_id: true },
  })

  const assignment = chore
    ? null
    : await prisma!.choreAssignment.findFirst({
        where: {
          OR: [{ photo_url: publicPath }, { photo_url: filename }],
        },
        select: { family_id: true },
      })

  const ownerFamilyId = chore?.family_id ?? assignment?.family_id ?? null

  // Not referenced by anything: do not serve it. This also covers orphaned
  // uploads, which have no owner to authorize against.
  if (!ownerFamilyId) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Cross-family reads are refused. 404 rather than 403 so the response does not
  // confirm that a file exists in another household.
  if (ownerFamilyId !== auth.user.family_id) {
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
