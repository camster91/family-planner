import { boundedRequestText, RequestBodyTooLarge } from '@/lib/bounded-request-text'
import { createAiUsageJob, type AiUsageJob } from '@/lib/ai-usage-server'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import {
  CaptureError,
  IMAGE_TOO_LARGE_MESSAGE,
  MAX_IMAGE_BASE64_LENGTH,
  draftFromText,
  draftFromImage,
  resolveCaptureConfig,
} from '@/lib/capture'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { CAPTURE_CHILD_MESSAGE, canUseCapture } from '@/lib/role-capabilities'
import { logRouteWarning } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'

export const dynamic = 'force-dynamic'

// Accepted image types for screenshot capture. Kept deliberately narrow.
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

// The largest JSON body worth parsing: the image cap plus room for the other fields.
const MAX_CAPTURE_BODY_BYTES = MAX_IMAGE_BASE64_LENGTH + 64 * 1024

// POST /api/capture
// Body: { text: string }              -> one proposed draft
//       { imageBase64, mimeType }     -> a list of proposed events from a photo
// Returns PROPOSALS. Nothing is saved here — the user confirms first, which is
// what makes a cheap model safe to use.
export async function POST(request: NextRequest) {
  const meter: { current: AiUsageJob } = { current: undefined }
  try {
    let response = await handlePOST(request, value => { meter.current = value })
    if (response.status >= 200 && response.status < 300 && (process.env.FAMILY_AI_PROVIDER_DISABLED === "1" || (meter.current && !(await meter.current.replyAllowed())))) {
      response = NextResponse.json({ error: "AI settings changed or calls were paused. Refresh before trying again.", code: "CAPTURE_SOURCE_CHANGED" }, { status: 409, headers: { "Cache-Control": "private, no-store" } })
    }
    response.headers.set("Cache-Control", "private, no-store")
    await meter.current?.finish(response.status)
    return response
  } catch (error) { await meter.current?.finish(500); throw error }
}
async function handlePOST(request: NextRequest, setMeter: (value: AiUsageJob) => void) {
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

    // Refuse an oversized body before parsing it into memory. A request
    // without Content-Length (chunked) is bounded by the streamed reader too.
    const declaredLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(declaredLength) && declaredLength > MAX_CAPTURE_BODY_BYTES) {
      return NextResponse.json({ error: IMAGE_TOO_LARGE_MESSAGE }, { status: 413 })
    }

    let body: any
    try {
      body = JSON.parse(await boundedRequestText(request, MAX_CAPTURE_BODY_BYTES))
    } catch (error) {
      if (error instanceof RequestBodyTooLarge) return NextResponse.json({ error: IMAGE_TOO_LARGE_MESSAGE }, { status: 413 })
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const initialAuth = auth
    async function proposalReply(body: unknown) {
      const [current, refusal] = await authenticateWithFamily(request)
      if (refusal) { refusal.headers.set('Cache-Control', 'private, no-store'); return refusal }
      if (current.user.id !== initialAuth.user.id || current.user.family_id !== initialAuth.user.family_id || current.user.role !== initialAuth.user.role || (current.payload?.tv ?? 0) !== (initialAuth.payload?.tv ?? 0) || !canUseCapture(current.user.role)) {
        return NextResponse.json({ error: 'Your account or household changed. Please try again.', code: 'CAPTURE_SOURCE_CHANGED' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
      }
      const latest = await prisma!.family.findUnique({ where: { id: current.user.family_id }, select: { capture_ai_key_enc: true, capture_ai_base_url: true, capture_ai_model: true } })
      const latestConfig = resolveCaptureConfig(latest)
      // Credentials stay in memory: never log the differing values.
      if (!latest || !latestConfig || JSON.stringify(latestConfig) !== JSON.stringify(config)) return NextResponse.json({ error: 'Capture settings changed. Please try again.', code: 'CAPTURE_SOURCE_CHANGED' }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })
      return NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } })
    }

    // Image path: extract several events from a photo/screenshot.
    if (typeof body?.imageBase64 === 'string' && body.imageBase64) {
      if (body.imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
        return NextResponse.json({ error: IMAGE_TOO_LARGE_MESSAGE }, { status: 413 })
      }
      const mimeType =
        typeof body.mimeType === 'string' && ALLOWED_IMAGE_TYPES.includes(body.mimeType)
          ? body.mimeType
          : 'image/jpeg'
      const meter = createAiUsageJob(prisma!, { userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload?.tv ?? 0 }, config, 'capture_photo')
      setMeter(meter)
      const result = meter ? await draftFromImage(body.imageBase64, mimeType, config, meter.observer) : await draftFromImage(body.imageBase64, mimeType, config)
      return await proposalReply({ image: result })
    }

    // Text path: one phrase, one draft.
    const text = typeof body?.text === 'string' ? body.text : ''
    if (!text.trim()) {
      return NextResponse.json({ error: 'Nothing to capture' }, { status: 400 })
    }

    const meter = createAiUsageJob(prisma!, { userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload?.tv ?? 0 }, config, 'capture_text')
    setMeter(meter)
    const draft = meter ? await draftFromText(text, config, meter.observer) : await draftFromText(text, config)
    return await proposalReply({ draft })
  } catch (error) {
    // Only messages written for users are returned; anything else (network
    // errors, DNS failures) stays in the server log.
    logRouteWarning('POST /api/capture', error, getRequestId(request))
    if (error instanceof CaptureError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    return NextResponse.json({ error: 'Capture failed. Try again shortly.' }, { status: 500 })
  }
}

// GET /api/capture — is capture available for this family?
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) { error.headers.set('Cache-Control', 'private, no-store'); return error }

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
    role: auth.user.role,
    // The browser uses this authenticated namespace to retain only confirmed
    // recovery envelopes. It never receives provider configuration or keys.
    userId: auth.user.id,
    familyId: auth.user.family_id,
    ...(allowed ? {} : { message: CAPTURE_CHILD_MESSAGE }),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
