import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { updateProjectSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET — Get a single project with tasks and progress stats
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    const project = await prisma!.project.findUnique({
      where: { id },
      include: {
        creator: {
          select: { id: true, name: true, avatar_url: true },
        },
        tasks: {
          include: {
            assignee: {
              select: { id: true, name: true, avatar_url: true },
            },
          },
          orderBy: { position: 'asc' },
        },
        _count: {
          select: { tasks: true },
        },
      },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Verify family ownership
    const familyError = requireFamilyMatch(
      project.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    // Compute progress stats
    const totalTasks = project._count.tasks
    const completedTasks = project.tasks.filter((t) => t.completed).length
    const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

    const { _count, ...result } = project

    return NextResponse.json({
      project: {
        ...result,
        taskCount: totalTasks,
        completedTaskCount: completedTasks,
        progress,
      },
    })
  } catch (error) {
    console.error('Error fetching project:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH — Update a project (family-scoped)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = updateProjectSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Verify the project exists and belongs to the user's family
    const existing = await prisma!.project.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!existing) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const familyError = requireFamilyMatch(
      existing.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    // Build update data — only include fields that were provided
    const data: Record<string, unknown> = {}
    const { name, description, color, status } = parsed.data
    if (name !== undefined) data.name = name
    if (description !== undefined) data.description = description
    if (color !== undefined) data.color = color
    if (status !== undefined) data.status = status

    const updated = await prisma!.project.update({
      where: { id },
      data,
      include: {
        creator: {
          select: { id: true, name: true, avatar_url: true },
        },
        _count: {
          select: { tasks: true },
        },
      },
    })

    return NextResponse.json({ project: updated })
  } catch (error) {
    console.error('Error updating project:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE — Delete a project (family-scoped, cascades to tasks)
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id } = await context.params

    if (!id) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    // Verify the project exists and belongs to the user's family
    const project = await prisma!.project.findUnique({
      where: { id },
      select: { family_id: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const familyError = requireFamilyMatch(
      project.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    // Delete the project (cascades to tasks due to onDelete: Cascade in schema)
    await prisma!.project.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting project:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
