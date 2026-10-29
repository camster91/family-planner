import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { sendMessageSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { authorizeMessageActorInTx, createMessageEffect } from '@/lib/message-mutations'
import { messageExpectedOwnerMatches, messageSendWindowOpen, messageSendWindowRefusal } from '@/lib/message-owner-contract'
import { boundedRequestText, RequestBodyTooLarge } from '@/lib/bounded-request-text'
import { storageBackend } from '@/lib/storage-backend'
import { sendD1Message } from '@/lib/cloudflare/messages'

// POST - Send a message
export async function postMessage(request: NextRequest, requireOwner = false) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError

    let body: unknown
    try {
      body = requireOwner ? JSON.parse(await boundedRequestText(request, 64 * 1024)) : await request.json()
    } catch (error) {
      return NextResponse.json({ error: error instanceof RequestBodyTooLarge ? 'Message request is too large' : 'Invalid JSON' }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 })
    }
    const parsed = sendMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    if (requireOwner && parsed.data.expected_user_id === undefined)
      return NextResponse.json({ error: 'Message owner context is required', code: 'MESSAGE_OWNER_REQUIRED' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
    if (!messageExpectedOwnerMatches(parsed.data, { userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }))
      return NextResponse.json({ error: 'Message household changed. Reload before sending.', code: 'MESSAGE_OWNER_CHANGED', retryable: false }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } })

    if (requireOwner && key === null)
      return NextResponse.json({ error: 'Idempotency-Key is required for this message endpoint', code: 'MESSAGE_KEY_REQUIRED' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })

    if (requireOwner && parsed.data.issued_at === undefined)
      return NextResponse.json({ error: 'Original send time is required', code: 'MESSAGE_SEND_TIME_REQUIRED' }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } })
    if (parsed.data.issued_at !== undefined && !messageSendWindowOpen(parsed.data.issued_at)) {
      const refusal = messageSendWindowRefusal()
      return NextResponse.json(refusal.body, { status: refusal.status, headers: { 'Cache-Control': 'private, no-store' } })
    }

    const response = storageBackend() === 'd1'
      ? await sendD1Message(
          {
            userId: auth.user.id,
            familyId: auth.user.family_id,
            role: auth.user.role,
            generation: auth.payload.tv ?? 0,
          },
          parsed.data,
          key,
        )
      : await withIdempotency(
          prisma!,
          key,
          { scope: `user:${auth.user.id}`, familyId: auth.user.family_id, userId: auth.user.id, action: 'message.create' },
          parsed.data,
          ({ recordId }) => createMessageEffect(
            prisma!,
            { id: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 },
            parsed.data,
            recordId,
          ),
          {
            beforeReplay: () => prisma!.$transaction(async (tx) =>
              authorizeMessageActorInTx(tx, { id: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }),
            ),
          },
        )
    if (response instanceof NextResponse) {
      response.headers.set('Cache-Control', 'private, no-store')
      return response
    }
    return NextResponse.json(response.body, { status: response.status, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    logRouteError('POST /api/messages', error, getRequestId(request))
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

