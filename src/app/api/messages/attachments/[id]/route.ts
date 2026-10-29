import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { refusePairedDevice } from '@/lib/device-route'
import { featureGate } from '@/lib/feature-gate-server'
import { logRouteError } from '@/lib/api-error'
import { getRequestId } from '@/lib/request-id'
import { prisma } from '@/lib/prisma'
import { messageAttachmentFilePath } from '@/lib/message-attachments'
import { storageBackend } from '@/lib/storage-backend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/messages/attachments/:id — serve only a caller-family attachment. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal
    const [auth, authError] = await authenticateWithFamily(request)
    if (authError) return authError
    const gate = await featureGate(auth.user.family_id, 'messages')
    if (gate) return gate

    const { id } = await params
    if (storageBackend() === 'd1') {
      const [{ getPrivateObjectStore, privateObjectGenerationKey, privateObjectKey }, { getD1MessageAttachment }] = await Promise.all([
        import('@/lib/cloudflare/storage'),
        import('@/lib/cloudflare/message-attachments'),
      ])
      const attachment = await getD1MessageAttachment(auth.user.family_id, id)
      if (!attachment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const bucket = await getPrivateObjectStore()
      const object = await bucket.get(privateObjectGenerationKey(auth.user.family_id, 'messages', attachment.filename, attachment.id))
        ?? await bucket.get(privateObjectKey(auth.user.family_id, 'messages', attachment.filename))
      if (!object) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return new NextResponse(object.body as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': object.httpMetadata?.contentType ?? attachment.content_type,
          'Cache-Control': 'private, max-age=300',
          ...(object.etag ? { ETag: `"${object.etag}"` } : {}),
        },
      })
    }
    const attachment = await prisma!.messageAttachment.findFirst({
      // Draft rows have no message yet. Do not make an uploaded-but-unclaimed
      // file readable by every household member; serving starts after the
      // message transaction claims it.
      where: { id, family_id: auth.user.family_id, message_id: { not: null } },
      select: { filename: true, content_type: true },
    })
    if (!attachment)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const filepath = messageAttachmentFilePath(attachment.filename)
    if (!existsSync(filepath))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const bytes = await readFile(filepath)
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': attachment.content_type,
        'Cache-Control': 'private, max-age=300',
        ETag: `"${createHash('md5').update(bytes).digest('hex')}"`,
      },
    })
  } catch (error) {
    logRouteError(
      'GET /api/messages/attachments/[id]',
      error,
      getRequestId(request),
    )
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    )
  }
}
