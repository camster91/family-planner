import { Suspense } from 'react'
import { PlusCircle, FolderKanban, LayoutGrid } from 'lucide-react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { cn } from '@/lib/utils'
import ProjectCard, { type ProjectCardData } from '@/components/projects/ProjectCard'

export const dynamic = 'force-dynamic'

// --- Server data fetching section ---

async function ProjectsContent() {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true, role: true },
  })

  const familyId = user?.family_id
  if (!familyId) {
    return (
      <div className="text-center py-20">
        <FolderKanban className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 mb-2">No family set up</h2>
        <p className="text-gray-500">
          Create or join a family to start managing projects together.
        </p>
      </div>
    )
  }

  // Fetch projects with task counts and completed counts
  const projects = await prisma!.project.findMany({
    where: { family_id: familyId },
    include: {
      creator: {
        select: { name: true, avatar_url: true },
      },
      _count: { select: { tasks: true } },
      tasks: {
        where: { completed: true },
        select: { id: true },
      },
    },
    orderBy: { created_at: 'desc' },
  })

  // Transform to card-friendly shape
  const projectCards: ProjectCardData[] = projects.map((p) => {
    const { tasks, _count, ...rest } = p
    return {
      ...rest,
      status: rest.status as 'active' | 'completed' | 'archived',
      taskCount: _count.tasks,
      completedTaskCount: tasks.length,
    }
  })

  const activeProjects = projectCards.filter((p) => p.status === 'active')
  const completedProjects = projectCards.filter((p) => p.status === 'completed')
  const archivedProjects = projectCards.filter((p) => p.status === 'archived')

  return (
    <div className="space-y-10">
      {/* Active projects */}
      {activeProjects.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Active Projects
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {activeProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Completed projects */}
      {completedProjects.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Completed
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {completedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Archived projects */}
      {archivedProjects.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Archived
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {archivedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {projectCards.length === 0 && (
        <div className="text-center py-20">
          <div className="w-20 h-20 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-5">
            <LayoutGrid className="w-10 h-10 text-blue-400" />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mb-2">
            Start your first project
          </h2>
          <p className="text-sm text-gray-500 max-w-sm mx-auto mb-6 leading-relaxed">
            Organize family goals, home projects, or any collaborative effort with
            tasks, assignees, and progress tracking.
          </p>
          <Link
            href="/dashboard/projects/create"
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-xl shadow-sm transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
            Create your first project
          </Link>
        </div>
      )}
    </div>
  )
}

// --- Page skeleton ---

function ProjectsSkeleton() {
  return (
    <div className="space-y-10 animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl bg-white border p-0 overflow-hidden">
            <div className="h-1.5 bg-gray-200" />
            <div className="p-5 space-y-3">
              <div className="h-5 bg-gray-200 rounded w-3/4" />
              <div className="h-4 bg-gray-100 rounded w-full" />
              <div className="h-2 bg-gray-100 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Page export ---

export default function ProjectsPage() {
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Projects</h1>
          <p className="mt-1 text-sm text-gray-500">
            Track family projects, goals, and collaborative tasks.
          </p>
        </div>
        <Link
          href="/dashboard/projects/create"
          className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-xl shadow-sm transition-colors self-start"
        >
          <PlusCircle className="w-4 h-4" />
          New Project
        </Link>
      </div>

      {/* Content with suspense boundary */}
      <Suspense fallback={<ProjectsSkeleton />}>
        <ProjectsContent />
      </Suspense>
    </div>
  )
}
