import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarPlus } from 'lucide-react'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { LargeHeader } from '@/components/ui/large-header'
import { ProgressRing } from '@/components/ui/progress-ring'
import { EmptyState } from '@/components/ui/empty-state'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { isFeatureEnabled, normalizeFeatures } from '@/lib/features'
import { ProjectDetailActions } from './ProjectDetailActions'
import { ProjectTaskChecklist, type ChecklistTask } from './ProjectTaskChecklist'
import { SendToCalendarButton } from './SendToCalendarButton'
import { AddProjectTaskForm } from '@/components/projects/AddProjectTaskForm'

export const dynamic = 'force-dynamic'

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>
}

async function ProjectDetailContent({ id }: { id: string }) {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true, family: { select: { features: true } } },
  })

  const familyId = user?.family_id
  if (!familyId) return null

  // Same server-side gate as the projects list (route inventory F-2).
  if (!isFeatureEnabled(normalizeFeatures(user?.family?.features), 'projects')) {
    return <FeatureOffState featureKey="projects" />
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
    },
  })

  if (!project || project.family_id !== familyId) {
    notFound()
  }

  const totalTasks = project.tasks.length
  const completedTasks = project.tasks.filter((t) => t.completed).length
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

  // Get family members for assignment dropdown
  const familyMembers = await prisma!.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })

  // Plain data only: this is a server component, so nothing it passes to the
  // client components below may be a function.
  const taskData: ChecklistTask[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    completed: t.completed,
    due_date: t.due_date ? t.due_date.toISOString() : null,
  }))

  const isParent = user.role === 'parent'
  const isComplete = project.status === 'completed' || progress === 100

  return (
    <div className="pb-20">
      {/* Back link + LargeHeader */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/projects" className="inline-flex items-center gap-1.5 text-subhead text-label-secondary hover:text-label-primary transition-colors mb-3">
          <ArrowLeft className="w-4 h-4" />
          Projects
        </Link>
        <LargeHeader
          title={project.name}
          subtitle={project.description || undefined}
          trailing={
            <ProjectDetailActions
              projectId={project.id}
              projectStatus={project.status as 'active' | 'completed' | 'archived'}
              isParent={isParent}
            />
          }
        />
      </div>

      <div className="px-4 space-y-6 mt-6">
        {/* Progress card */}
        <div className="card-apple p-5 flex items-center gap-5">
          <ProgressRing
            progress={totalTasks > 0 ? completedTasks / totalTasks : 0}
            size={80}
            strokeWidth={8}
          >
            <span className="text-[28px] font-bold leading-none">{progress}%</span>
          </ProgressRing>
          <div className="flex-1 min-w-0">
            <p className="text-title-3 text-label-primary leading-tight">
              {totalTasks > 0 ? `${completedTasks} of ${totalTasks} tasks done` : 'No tasks yet'}
            </p>
            {totalTasks > 0 && progress < 100 && (
              <p className="text-subhead text-label-secondary mt-1">{totalTasks - completedTasks} remaining</p>
            )}
            {progress === 100 && totalTasks > 0 && (
              <p className="text-subhead text-green-600 mt-1 font-medium">All done!</p>
            )}
          </div>
          {/* Color accent dot */}
          <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: project.color || '#3B82F6' }} />
        </div>

        {/* Tasks section */}
        <section>
          <p className="section-header">Tasks</p>
          {taskData.length === 0 ? (
            <EmptyState
              icon={CalendarPlus}
              glyphColor="projects"
              title="No tasks yet"
              description={
                project.status === 'active' ? 'Break this project into tasks with Add task.' : 'This project has no tasks.'
              }
            />
          ) : (
            <ProjectTaskChecklist
              projectId={project.id}
              tasks={taskData}
              canToggle={isParent && project.status === 'active'}
            />
          )}
          {/* Route inventory F-5 (#289): add a task to this project. The API
              takes tasks only while the project is active. */}
          {project.status === 'active' && (
            <div className="mt-3">
              <AddProjectTaskForm projectId={project.id} familyMembers={familyMembers} />
            </div>
          )}
        </section>

        {/* Send to Calendar CTA */}
        {project.status === 'active' && totalTasks > 0 && completedTasks < totalTasks && (
          <div className="card-apple p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-subhead text-label-primary font-semibold mb-1">Send tasks to calendar</h3>
              <p className="text-footnote text-label-secondary">
                Add incomplete tasks with due dates to the calendar as all-day events.
              </p>
            </div>
            <SendToCalendarButton projectId={project.id} />
          </div>
        )}
      </div>
    </div>
  )
}

// --- Skeleton ---

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse px-4">
      <div className="flex justify-between">
        <div className="h-4 w-28 bg-gray-200 rounded" />
        <div className="h-8 w-32 bg-gray-200 rounded-xl" />
      </div>
      <div className="card-apple p-5 h-32" />
      <div className="space-y-1">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-gray-100 rounded-xl" />
        ))}
      </div>
    </div>
  )
}

// --- Page export ---

export default function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  return (
    <Suspense fallback={<ProjectDetailSkeleton />}>
      <AsyncProjectDetail params={params} />
    </Suspense>
  )
}

async function AsyncProjectDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectDetailContent id={id} />
}