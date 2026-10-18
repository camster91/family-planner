import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { prisma } from '@/lib/prisma'
import { sniffImageType } from '@/lib/image-sniff'
import {
  MESSAGE_ATTACHMENT_MAX_BYTES,
  MESSAGE_ATTACHMENT_MAX_REQUEST_BYTES,
  messageAttachmentPath,
  pruneUnboundMessageAttachments,
  storeMessageAttachment,
  type MessageAttachmentMime,
} from '@/lib/message-attachments'
import { checkRateLimit } from '@/lib/rate-limit-db'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MESSAGE_UPLOAD_RATE_LIMIT = 20
const MESSAGE_UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000
export const MESSAGE_UPLOAD_MAX_REQUEST_BYTES = MESSAGE_ATTACHMENT_MAX_REQUEST_BYTES
const MESSAGE_MIMES = new Set<MessageAttachmentMime>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
])

function isMessageAttachmentMime(mime: string): mime is MessageAttachmentMime {
  return MESSAGE_MIMES.has(mime as MessageAttachmentMime)
}

class MessageUploadTooLargeError extends Error {
  constructor() {
    super('MESSAGE_UPLOAD_REQUEST_TOO_LARGE')
    this.name = 'MessageUploadTooLargeError'
  }
}

/**
 * Read a multipart body with a hard byte bound before formData() parses it.
 * Browser FormData requests commonly omit Content-Length, so the stream is
 * the authority when the header is absent. The fake requests used by route
 * tests have no body stream and provide formData() directly.
 */
async function readBoundedFormData(request: NextRequest): Promise<FormData> {
  if (!request.body) return request.formData()

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      if (value.byteLength > MESSAGE_ATTACHMENT_MAX_REQUEST_BYTES - total) {
        await reader.cancel().catch(() => {})
        throw new MessageUploadTooLargeError()
      }
      chunks.push(value)
      total += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  const replayable = new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  })
  return replayable.formData()
}

/** POST /api/messages/attachments — upload one private family-chat image. */
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal
    const [auth, authError] = await authenticateWithFamily(request)
    if (authError) return authError
    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    const rate = await checkRateLimit(
      `message-upload:${auth.user.id}`,
      MESSAGE_UPLOAD_RATE_LIMIT,
      MESSAGE_UPLOAD_RATE_WINDOW_MS,
    )
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many message attachments. Try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.max(1, Math.ceil(rate.retryAfterMs / 1000)),
            ),
          },
        },
      )
    }
    // formData() buffers the multipart body. Reject an explicitly invalid or
    // oversized declaration, then apply the same cap while reading the body.
    // Native browser FormData commonly omits Content-Length, so absence is
    // safe only because readBoundedFormData enforces the cap before parsing.
    const rawLength = request.headers.get('content-length')?.trim() ?? ''
    if (rawLength !== '') {
      const declaredLength = /^\d+$/.test(rawLength) ? Number(rawLength) : NaN
      if (
        !Number.isSafeInteger(declaredLength) ||
        declaredLength <= 0 ||
        declaredLength > MESSAGE_ATTACHMENT_MAX_REQUEST_BYTES
      ) {
        return NextResponse.json(
          { error: 'Message attachment request is too large or has no valid length.' },
          { status: 413 },
        )
      }
    }

    let formData: FormData
    try {
      formData = await readBoundedFormData(request)
    } catch (error) {
      if (error instanceof MessageUploadTooLargeError) {
        return NextResponse.json(
          { error: 'Message attachment request is too large.' },
          { status: 413 },
        )
      }
      return NextResponse.json(
        { error: 'Send an image as multipart/form-data with a "file" field' },
        { status: 400 },
      )
    }
    const file = formData.get('file')
    if (!file || !(file instanceof File))
      return NextResponse.json({ error: 'No image uploaded' }, { status: 400 })
    if (file.size > MESSAGE_ATTACHMENT_MAX_BYTES)
      return NextResponse.json(
        { error: 'Message attachment is too large.' },
        { status: 400 },
      )

    const bytes = new Uint8Array(await file.arrayBuffer())
    const sniffed = sniffImageType(bytes)
    if (!sniffed || !isMessageAttachmentMime(sniffed.mime)) {
      return NextResponse.json(
        {
          error: 'Message attachments must be JPEG, PNG, WebP or HEIC images.',
        },
        { status: 400 },
      )
    }

    await pruneUnboundMessageAttachments(prisma!, auth.user.family_id, {})
    const attachment = await storeMessageAttachment(
      prisma!,
      auth.user.family_id,
      auth.user.id,
      bytes,
      sniffed.mime,
      sniffed.ext,
    )
    return NextResponse.json(
      {
        attachment: {
          id: attachment.id,
          url: messageAttachmentPath(attachment.id),
          size: attachment.size_bytes,
          type: attachment.content_type,
        },
      },
      { status: 201 },
    )
  } catch (error) {
    logRouteError(
      'POST /api/messages/attachments',
      error,
      getRequestId(request),
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
