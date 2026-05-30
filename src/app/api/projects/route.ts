import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createProjectSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

// GET — List projects for the user's family with task counts
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') as 'active' | 'completed' | 'archived' | null

    const where: Record<string, unknown> = {
      family_id: auth.user.family_id,
    }

    if (status && ['active', 'completed', 'archived'].includes(status)) {
      where.status = status
    }

    const projects = await prisma!.project.findMany({
      where,
      include: {
        creator: {
          select: { id: true, name: true, avatar_url: true },
        },
        _count: {
          select: { tasks: true },
        },
        tasks: {
          where: { completed: true },
          select: { id: true },
        },
      },
      orderBy: { created_at: 'desc' },
    })

    // Transform to include computed task counts
    const result = projects.map((project) => {
      const { tasks, _count, ...rest } = project
      return {
        ...rest,
        taskCount: _count.tasks,
        completedTaskCount: tasks.length,
      }
    })

    return NextResponse.json({ projects: result })
  } catch (error) {
    console.error('Error fetching projects:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST — Create a new project
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const body = await request.json()
    const parsed = createProjectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    const { name, description, color, status } = parsed.data

    const project = await prisma!.project.create({
      data: {
        family_id: auth.user.family_id,
        name,
        description: description || null,
        color: color || '#3B82F6',
        status: status || 'active',
        created_by: auth.user.id,
      },
      include: {
        creator: {
          select: { id: true, name: true, avatar_url: true },
        },
        _count: {
          select: { tasks: true },
        },
      },
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    console.error('Error creating project:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
