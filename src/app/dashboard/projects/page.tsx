import { Suspense } from 'react'
import Link from 'next/link'
import { getServerUser } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { EmptyState } from '@/components/ui/empty-state'
import ProjectCard, { type ProjectCardData } from '@/components/projects/ProjectCard'

export const dynamic = 'force-dynamic'

async function ProjectsContent({ familyId }: { familyId: string }) {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

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
    <div className="space-y-8">
      {/* Active projects */}
      {activeProjects.length > 0 && (
        <section>
          <p className="section-header">Active</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {activeProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Completed projects */}
      {completedProjects.length > 0 && (
        <section>
          <p className="section-header">Completed</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {completedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Archived projects */}
      {archivedProjects.length > 0 && (
        <section>
          <p className="section-header">Archived</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {archivedProjects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {projectCards.length === 0 && (
        <div className="card-apple p-8 text-center">
          <EmptyState
            icon={FolderKanban}
            glyphColor="projects"
            title="No projects yet"
            description="Organize family goals, home projects, or any collaborative effort."
            action={
              <Link href="/dashboard/projects/create" className="btn-tinted bg-projects px-5 py-2 text-base font-medium">
                Create Project
              </Link>
            }
          />
        </div>
      )}
    </div>
  )
}

function ProjectsSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="card-apple p-5 h-40" />
        ))}
      </div>
    </div>
  )
}

import { FolderKanban } from 'lucide-react'

export default function ProjectsPage() {
  return (
    <div className="pb-20">
      <LargeHeader
        title="Projects"
        subtitle="Track family goals and collaborative tasks"
        className="px-4"
        trailing={
          <Link href="/dashboard/projects/create" className="btn-tinted bg-projects px-4 py-2 text-sm font-medium">
            New
          </Link>
        }
      />
      <div className="px-4 mt-6">
        <Suspense fallback={<ProjectsSkeleton />}>
          <ProjectsContentWrapper />
        </Suspense>
      </div>
    </div>
  )
}

async function ProjectsContentWrapper() {
  const sessionUser = await getServerUser()
  if (!sessionUser) return null

  const user = await prisma!.user.findUnique({
    where: { id: sessionUser.id },
    select: { family_id: true },
  })

  const familyId = user?.family_id
  if (!familyId) {
    return (
      <EmptyState
        icon={FolderKanban}
        glyphColor="projects"
        title="No family set up"
        description="Create or join a family to start managing projects together."
      />
    )
  }

  return <ProjectsContent familyId={familyId} />
}