import { Suspense } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarPlus, Pencil, Archive, Trash2, CheckCircle2, Clock } from 'lucide-react'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { cn, formatDate } from '@/lib/utils'
import ProjectTaskList, { type ProjectTaskData } from '@/components/projects/ProjectTaskList'
import { ProjectDetailActions } from './ProjectDetailActions'

export const dynamic = 'force-dynamic'

interface ProjectDetailPageProps {
  params: Promise<{ id: string }>
}

async function ProjectDetailContent({ id }: { id: string }) {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  })

  const familyId = user?.family_id
  if (!familyId) return null

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

  const taskData: ProjectTaskData[] = project.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    completed: t.completed,
    assigned_to: t.assigned_to,
    due_date: t.due_date ? t.due_date.toISOString() : null,
    position: t.position,
    assignee: t.assignee
      ? {
          id: t.assignee.id,
          name: t.assignee.name,
          avatar_url: t.assignee.avatar_url,
        }
      : null,
  }))

  const isParent = user.role === 'parent'
  const isComplete = project.status === 'completed' || progress === 100

  return (
    <div className="space-y-8">
      {/* Top bar: back + actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Link
          href="/dashboard/projects"
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to projects
        </Link>

        <ProjectDetailActions
          projectId={project.id}
          projectStatus={project.status as 'active' | 'completed' | 'archived'}
          isParent={isParent}
        />
      </div>

      {/* Project header card */}
      <div
        className="rounded-2xl bg-white border shadow-sm overflow-hidden"
      >
        {/* Color accent bar */}
        <div className="h-2 w-full" style={{ backgroundColor: project.color || '#3B82F6' }} />

        <div className="p-6 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
                <span
                  className={cn(
                    'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
                    project.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : project.status === 'completed'
                      ? 'bg-sky-50 text-sky-700 border-sky-200'
                      : 'bg-slate-100 text-slate-500 border-slate-200',
                  )}
                >
                  {project.status === 'active' ? 'Active' : project.status === 'completed' ? 'Completed' : 'Archived'}
                </span>
              </div>

              {project.description && (
                <p className="text-sm text-gray-500 leading-relaxed mb-5 max-w-2xl">
                  {project.description}
                </p>
              )}

              {/* Progress circle */}
              <div className="flex items-center gap-6">
                {/* Simple circular progress */}
                <div className="relative w-16 h-16 shrink-0">
                  <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke="#f1f5f9"
                      strokeWidth="6"
                    />
                    <circle
                      cx="32"
                      cy="32"
                      r="28"
                      fill="none"
                      stroke={project.color || '#3B82F6'}
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 28}`}
                      strokeDashoffset={`${2 * Math.PI * 28 * (1 - progress / 100)}`}
                      className="transition-all duration-700 ease-out"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-gray-800">{progress}%</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-sm font-medium text-gray-800">
                    <span className="text-emerald-600">{completedTasks}</span> of{' '}
                    <span className="text-gray-600">{totalTasks}</span> tasks complete
                  </p>
                  {totalTasks > 0 && progress < 100 && (
                    <p className="text-xs text-gray-400">
                      {totalTasks - completedTasks} remaining
                    </p>
                  )}
                  {progress === 100 && totalTasks > 0 && (
                    <p className="text-xs text-emerald-500 font-medium">All done!</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Creator + date info */}
          <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-4 text-xs text-gray-400">
            <span>
              Created by{' '}
              <span className="text-gray-600 font-medium">
                {project.creator?.name || 'Unknown'}
              </span>
            </span>
            <span>•</span>
            <span>Updated {formatDate(project.updated_at)}</span>
          </div>
        </div>
      </div>

      {/* Tasks section */}
      <div className="rounded-2xl bg-white border shadow-sm p-6 sm:p-8">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Tasks</h2>
          {totalTasks > 0 && (
            <span className="text-sm text-gray-400">
              {completedTasks}/{totalTasks}
            </span>
          )}
        </div>

        <ProjectTaskList
          tasks={taskData}
          projectId={project.id}
          projectStatus={project.status as 'active' | 'completed' | 'archived'}
          familyMembers={familyMembers}
        />
      </div>

      {/* Send to Calendar CTA */}
      {project.status === 'active' && totalTasks > 0 && completedTasks < totalTasks && (
        <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-indigo-800 mb-1">
              Send tasks to calendar
            </h3>
            <p className="text-xs text-indigo-600">
              Create 30-minute calendar events from incomplete tasks that have due dates.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl shadow-sm transition-colors"
            onClick={async () => {
              try {
                const res = await fetch(
                  `/api/projects/${project.id}/send-to-calendar`,
                  { method: 'POST' },
                )
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Failed')
                alert(`Created ${data.eventsCreated || 0} calendar events!`)
              } catch (err) {
                alert(err instanceof Error ? err.message : 'Something went wrong')
              }
            }}
          >
            <CalendarPlus className="w-4 h-4" />
            Send to Calendar
          </button>
        </div>
      )}
    </div>
  )
}

// --- Skeleton ---

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="flex justify-between">
        <div className="h-4 w-28 bg-gray-200 rounded" />
        <div className="h-8 w-32 bg-gray-200 rounded-xl" />
      </div>

      <div className="rounded-2xl bg-white border overflow-hidden">
        <div className="h-2 bg-gray-200" />
        <div className="p-8 space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/2" />
          <div className="h-4 bg-gray-100 rounded w-3/4" />
          <div className="h-16 w-16 bg-gray-200 rounded-full" />
        </div>
      </div>

      <div className="rounded-2xl bg-white border p-8 space-y-4">
        <div className="h-6 bg-gray-200 rounded w-24" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-gray-200" />
              <div className="h-4 bg-gray-100 rounded flex-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// --- Page export ---

export default function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  // params is a Promise in Next.js 14 App Router
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
