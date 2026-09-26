import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deviceError, deviceInternalError, deviceJson, killSwitch } from '@/lib/device-http'
import { requireDeviceManager } from '@/lib/device-route'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url')
}

function decodeCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw) return null
  const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(iso ?? '')
  if (!id || Number.isNaN(createdAt.getTime())) return null
  return { createdAt, id }
}

/**
 * GET /api/family/devices/:id/events?cursor — recent audit rows for one tablet
 * (parent only), 50 per page, newest first. Metadata carries fixed keys only.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const off = killSwitch()
  if (off) return off
  try {
    const manager = await requireDeviceManager(request)
    if (!manager.ok) return manager.response
    const { id } = await params
    const { familyId } = manager

    const device = await prisma!.householdDevice.findFirst({ where: { id, family_id: familyId }, select: { id: true } })
    if (!device) return deviceError(404, 'NOT_FOUND')

    const rawCursor = request.nextUrl.searchParams.get('cursor')
    const cursor = decodeCursor(rawCursor)
    if (rawCursor && !cursor) return deviceError(400, 'VALIDATION_ERROR', { message: 'Invalid cursor.' })

    const rows = await prisma!.deviceAuditEvent.findMany({
      where: {
        family_id: familyId,
        device_id: id,
        ...(cursor
          ? {
              OR: [
                { created_at: { lt: cursor.createdAt } },
                { created_at: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        type: true,
        metadata: true,
        created_at: true,
        actor: { select: { name: true, family_id: true } },
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
    })

    const page = rows.slice(0, PAGE_SIZE)
    const last = page[page.length - 1]
    return deviceJson({
      events: page.map((e) => ({
        type: e.type,
        // A member who has since left the household is not named here.
        actorName: e.actor && e.actor.family_id === familyId ? e.actor.name : null,
        createdAt: e.created_at.toISOString(),
        metadata: e.metadata ?? {},
      })),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last.created_at, last.id) : null,
    })
  } catch (error) {
    return deviceInternalError('family_devices.events', error)
  }
}
