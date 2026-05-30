import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily, requireFamilyMatch } from '@/lib/api-auth'
import { updateProjectTaskSchema } from '@/lib/validations'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>
}

// PATCH — Update a task (family-scoped via project)
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id: projectId, taskId } = await context.params

    if (!projectId || !taskId) {
      return NextResponse.json(
        { error: 'Project ID and Task ID are required' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const parsed = updateProjectTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Verify the task exists and fetch its project's family for scoping
    const task = await prisma!.projectTask.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: { id: true, family_id: true },
        },
      },
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    // Ensure the task belongs to the specified project
    if (task.project_id !== projectId) {
      return NextResponse.json(
        { error: 'Task does not belong to this project' },
        { status: 404 }
      )
    }

    // Verify family ownership via the project
    const familyError = requireFamilyMatch(
      task.project.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    const { title, description, completed, assigned_to, due_date, position } =
      parsed.data

    // If assigned_to is being changed, verify the user belongs to the same family
    if (assigned_to) {
      const assignee = await prisma!.user.findUnique({
        where: { id: assigned_to },
        select: { family_id: true },
      })

      if (!assignee) {
        return NextResponse.json(
          { error: 'Assigned user not found' },
          { status: 404 }
        )
      }

      if (assignee.family_id !== auth.user.family_id) {
        return NextResponse.json(
          { error: 'Cannot assign task to a user outside your family' },
          { status: 403 }
        )
      }
    }

    // Build update data — only include fields that were provided
    const data: Record<string, unknown> = {}
    if (title !== undefined) data.title = title
    if (description !== undefined) data.description = description
    if (completed !== undefined) data.completed = completed
    if (assigned_to !== undefined) data.assigned_to = assigned_to
    if (due_date !== undefined)
      data.due_date = due_date ? new Date(due_date) : null
    if (position !== undefined) data.position = position

    const updated = await prisma!.projectTask.update({
      where: { id: taskId },
      data,
      include: {
        assignee: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
    })

    // Touch the project's updated_at
    await prisma!.project.update({
      where: { id: projectId },
      data: { updated_at: new Date() },
    })

    return NextResponse.json({ task: updated })
  } catch (error) {
    console.error('Error updating project task:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE — Delete a task (family-scoped via project)
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const { id: projectId, taskId } = await context.params

    if (!projectId || !taskId) {
      return NextResponse.json(
        { error: 'Project ID and Task ID are required' },
        { status: 400 }
      )
    }

    // Verify the task exists and the project belongs to the family
    const task = await prisma!.projectTask.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: { id: true, family_id: true },
        },
      },
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    // Ensure the task belongs to the specified project
    if (task.project_id !== projectId) {
      return NextResponse.json(
        { error: 'Task does not belong to this project' },
        { status: 404 }
      )
    }

    // Verify family ownership via the project
    const familyError = requireFamilyMatch(
      task.project.family_id,
      auth.user.family_id
    )
    if (familyError) return familyError

    await prisma!.projectTask.delete({ where: { id: taskId } })

    // Touch the project's updated_at
    await prisma!.project.update({
      where: { id: projectId },
      data: { updated_at: new Date() },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting project task:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
