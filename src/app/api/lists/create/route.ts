import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createListSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createListSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
    }

    const { name, type, description } = parsed.data

    const list = await prisma!.list.create({
      data: {
        family_id: auth.user.family_id,
        name,
        type,
        description: description || null,
        created_by: auth.user.id,
      },
    })

    return NextResponse.json({ success: true, list })
  } catch (error) {
    console.error('Error creating list:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
