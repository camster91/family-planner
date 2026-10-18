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
    const attachment = await prisma!.messageAttachment.findFirst({
      where: { id, family_id: auth.user.family_id },
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
