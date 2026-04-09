import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateRequest } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request)
    if (error) return error

    // Rate limit lookups to prevent enumeration
    const rateCheck = checkRateLimit(`lookup:${payload.userId}`, 20, 60 * 1000)
    if (!rateCheck.allowed) {
      return NextResponse.json({ error: 'Too many lookup attempts' }, { status: 429 })
    }

    const code = request.nextUrl.searchParams.get('code')
    if (!code || code.length < 3) {
      return NextResponse.json({ error: 'Valid code is required' }, { status: 400 })
    }

    // Look up by invite code directly
    const family = await prisma!.family.findUnique({
      where: { invite_code: code },
      select: { id: true, name: true },
    })

    if (!family) {
      // Fallback: try the old FAM-{id} format
      const familyIdMatch = code.match(/FAM-([A-Z0-9]+)/i)
      if (familyIdMatch) {
        const partialId = familyIdMatch[1].toLowerCase()
        const familyById = await prisma!.family.findFirst({
          where: { id: { startsWith: partialId } },
          select: { id: true, name: true },
        })

        if (familyById) {
          return NextResponse.json({ family: familyById })
        }
      }

      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error looking up family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
