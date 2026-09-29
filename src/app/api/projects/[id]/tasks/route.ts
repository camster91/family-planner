import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { createProjectTaskSchema } from '@/lib/validations'
import { featureGate } from '@/lib/feature-gate-server'

export const dynamic = 'force-dynamic'

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET — List tasks for a project (family-scoped via project)
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'projects')
    if (gate) return gate

    const { id: projectId } = await context.params

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    // The project is looked up with the caller's household: another
    // household's project is the same 404 as a missing one (#289).
    const project = await prisma!.project.findFirst({
      where: { id: projectId, family_id: auth.user.family_id },
      select: { id: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const { searchParams } = new URL(request.url)
    const filterCompleted = searchParams.get('completed')

    const where: Record<string, unknown> = { project_id: projectId }

    if (filterCompleted === 'true') {
      where.completed = true
    } else if (filterCompleted === 'false') {
      where.completed = false
    }

    const tasks = await prisma!.projectTask.findMany({
      where,
      include: {
        assignee: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    })

    return NextResponse.json({ tasks })
  } catch (error) {
    console.error('Error fetching project tasks:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST — Create a new task within a project. Any household member (parent,
// teen, child); the "Add task" form on /dashboard/projects/[id] calls it
// (route inventory F-5, #289). Active projects only.
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'projects')
    if (gate) return gate

    const { id: projectId } = await context.params

    if (!projectId) {
      return NextResponse.json(
        { error: 'Project ID is required' },
        { status: 400 }
      )
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = createProjectTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      )
    }

    // Household-scoped lookup: another household's project is the same 404
    // as a missing one (#289).
    const project = await prisma!.project.findFirst({
      where: { id: projectId, family_id: auth.user.family_id },
      select: { status: true },
    })

    if (!project) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    // Prevent adding tasks to completed or archived projects
    if (project.status !== 'active') {
      return NextResponse.json(
        { error: 'Cannot add tasks to a completed or archived project' },
        { status: 400 }
      )
    }

    const { title, description, assigned_to, due_date } = parsed.data

    // An assignee must be a member of the caller's household; a member of
    // another household is the same 404 as an unknown id (#289).
    if (assigned_to) {
      const assignee = await prisma!.user.findFirst({
        where: { id: assigned_to, family_id: auth.user.family_id },
        select: { id: true },
      })

      if (!assignee) {
        return NextResponse.json(
          { error: 'Assigned user not found' },
          { status: 404 }
        )
      }
    }

    // Determine the next position for the task
    const maxPosition = await prisma!.projectTask.aggregate({
      where: { project_id: projectId },
      _max: { position: true },
    })
    const nextPosition = (maxPosition._max.position ?? -1) + 1

    const task = await prisma!.projectTask.create({
      data: {
        project_id: projectId,
        title,
        description: description || null,
        assigned_to: assigned_to || null,
        due_date: due_date ? new Date(due_date) : null,
        position: nextPosition,
      },
      include: {
        assignee: {
          select: { id: true, name: true, avatar_url: true },
        },
      },
    })

    // Update the project's updated_at timestamp
    await prisma!.project.update({
      where: { id: projectId },
      data: { updated_at: new Date() },
    })

    return NextResponse.json({ task }, { status: 201 })
  } catch (error) {
    console.error('Error creating project task:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
