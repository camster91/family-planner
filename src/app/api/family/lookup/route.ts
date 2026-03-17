import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('session_token')?.value
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const payload = verifyToken(token)
    if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const code = request.nextUrl.searchParams.get('code')
    if (!code) {
      return NextResponse.json({ error: 'Code is required' }, { status: 400 })
    }

    // Extract family ID from code (FAM-{family_id_slice})
    const familyIdMatch = code.match(/FAM-([A-Z0-9]+)/i)
    if (!familyIdMatch) {
      return NextResponse.json({ error: 'Invalid family code format' }, { status: 400 })
    }

    const partialId = familyIdMatch[1].toLowerCase()

    const family = await prisma!.family.findFirst({
      where: {
        id: { contains: partialId },
      },
      select: { id: true, name: true },
    })

    if (!family) {
      return NextResponse.json({ error: 'Family not found' }, { status: 404 })
    }

    return NextResponse.json({ family })
  } catch (error) {
    console.error('Error looking up family:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
