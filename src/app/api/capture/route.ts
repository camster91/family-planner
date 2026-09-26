import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { CaptureError, draftFromText, draftFromImage, resolveCaptureConfig } from '@/lib/capture'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { CAPTURE_CHILD_MESSAGE, canUseCapture } from '@/lib/role-capabilities'

export const dynamic = 'force-dynamic'

// Accepted image types for screenshot capture. Kept deliberately narrow.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

// POST /api/capture
// Body: { text: string }              -> one proposed draft
//       { imageBase64, mimeType }     -> a list of proposed events from a photo
// Returns PROPOSALS. Nothing is saved here — the user confirms first, which is
// what makes a cheap model safe to use.
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    // D4 (#102): capture spends the family's own AI key. Parents and teens may
    // use it; a child is refused before any provider lookup or rate-limit write.
    if (!canUseCapture(auth.user.role)) {
      return NextResponse.json({ error: CAPTURE_CHILD_MESSAGE }, { status: 403 })
    }

    // The provider is configured per family, in the app, not in the server env.
    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: {
        capture_ai_key_enc: true,
        capture_ai_base_url: true,
        capture_ai_model: true,
      },
    })
    const config = resolveCaptureConfig(family)
    if (!config) {
      return NextResponse.json(
        { error: 'Capture is not set up yet. Add an AI key in Settings to use it.' },
        { status: 503 }
      )
    }

    // Cheap-model calls cost money, so keep a firm ceiling per user.
    const rate = await checkRateLimit(`capture:${auth.user.id}`, 30, 60 * 60 * 1000)
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many captures this hour. Try again shortly.' },
        { status: 429 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    // Image path: extract several events from a photo/screenshot.
    if (typeof body?.imageBase64 === 'string' && body.imageBase64) {
      const mimeType =
        typeof body.mimeType === 'string' && ALLOWED_IMAGE_TYPES.includes(body.mimeType)
          ? body.mimeType
          : 'image/jpeg'
      const result = await draftFromImage(body.imageBase64, mimeType, config)
      return NextResponse.json({ image: result })
    }

    // Text path: one phrase, one draft.
    const text = typeof body?.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return NextResponse.json({ error: 'Nothing to capture' }, { status: 400 })
    }

    const draft = await draftFromText(text, config)
    return NextResponse.json({ draft })
  } catch (error) {
    // Only messages written for users are returned; anything else (network
    // errors, DNS failures) stays in the server log.
    console.warn('Capture error:', error instanceof Error ? error.message : error)
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Capture failed. Try again shortly.' }, { status: 500 })
  }
}

// GET /api/capture — is capture available for this family?
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error

  const family = await prisma!.family.findUnique({
    where: { id: auth.user.family_id },
    select: {
      capture_ai_key_enc: true,
      capture_ai_base_url: true,
      capture_ai_model: true,
    },
  })
  const config = resolveCaptureConfig(family)
  // `allowed` lets the UI show "Ask a parent to add this." to a child instead
  // of a box that would only ever return 403 (D4).
  const allowed = canUseCapture(auth.user.role)
  return NextResponse.json({
    configured: Boolean(config),
    model: config?.model ?? null,
    allowed,
    ...(allowed ? {} : { message: CAPTURE_CHILD_MESSAGE }),
  })
}
