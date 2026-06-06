'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Glyph } from '@/components/ui/glyph'

export interface ProjectCardData {
  id: string
  name: string
  description?: string | null
  status: 'active' | 'completed' | 'archived'
  color: string
  taskCount: number
  completedTaskCount: number
  creator?: {
    name: string
    avatar_url?: string | null
  } | null
}

interface ProjectCardProps {
  project: ProjectCardData
  className?: string
}

const statusBadgeClasses: Record<string, string> = {
  active: 'bg-green-100 text-green-700 border-green-200',
  completed: 'bg-blue-100 text-blue-700 border-blue-200',
  archived: 'bg-gray-100 text-gray-500 border-gray-200',
}

export default function ProjectCard({ project, className }: ProjectCardProps) {
  const router = useRouter()
  const percent =
    project.taskCount > 0
      ? Math.round((project.completedTaskCount / project.taskCount) * 100)
      : 0
  const isComplete = project.status === 'completed' || percent === 100

  return (
    <button
      type="button"
      onClick={() => router.push(`/dashboard/projects/${project.id}`)}
      className={cn(
        'card-apple p-5 flex flex-col gap-4 text-left w-full',
        'hover:bg-[var(--surface-fill-secondary)] transition-colors duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-projects',
        className,
      )}
    >
      {/* Header: glyph + name + status badge */}
      <div className="flex items-start gap-3">
        <Glyph color="projects" size="md">
          <span className="text-lg">📋</span>
        </Glyph>
        <div className="flex-1 min-w-0">
          <h3 className="text-title-3 text-label-primary font-semibold leading-tight line-clamp-2">
            {project.name}
          </h3>
        </div>
        <span className={cn('shrink-0 text-caption-1 px-2.5 py-1 rounded-full font-medium border', statusBadgeClasses[project.status])}>
          {project.status === 'active' ? 'Active' : project.status === 'completed' ? 'Done' : 'Archived'}
        </span>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-footnote text-label-secondary line-clamp-2 leading-relaxed">{project.description}</p>
      )}

      {/* Progress bar */}
      {project.taskCount > 0 ? (
        <div className="space-y-1.5 mt-auto">
          <div className="h-1 rounded-full bg-surface-fill overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-700 ease-out', isComplete ? 'bg-success' : 'bg-projects')}
              style={{ width: `${percent}%` }}
            />
          </div>
          <p className="text-caption-1 text-label-tertiary">
            {project.completedTaskCount} of {project.taskCount} tasks
          </p>
        </div>
      ) : (
        <p className="text-caption-1 text-label-tertiary mt-auto">No tasks yet</p>
      )}
    </button>
  )
}