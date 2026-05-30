'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { FolderKanban, CheckCircle2, Clock } from 'lucide-react'

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
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  completed: 'bg-sky-50 text-sky-700 border-sky-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
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
        'group relative w-full text-left rounded-2xl border bg-white p-0 overflow-hidden',
        'shadow-sm hover:shadow-md transition-all duration-200',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500',
        className,
      )}
    >
      {/* Color accent bar at top */}
      <div
        className="h-1.5 w-full"
        style={{ backgroundColor: project.color || '#3B82F6' }}
      />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <h3 className="font-semibold text-gray-900 text-base leading-snug line-clamp-2 group-hover:text-blue-600 transition-colors">
            {project.name}
          </h3>

          <span
            className={cn(
              'shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border',
              statusBadgeClasses[project.status] || statusBadgeClasses.active,
            )}
          >
            {project.status === 'active' ? 'Active' : project.status === 'completed' ? 'Done' : 'Archived'}
          </span>
        </div>

        {/* Description */}
        {project.description && (
          <p className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed">
            {project.description}
          </p>
        )}

        {/* Progress bar */}
        {project.taskCount > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {project.completedTaskCount} / {project.taskCount} tasks
              </span>
              <span className="font-medium text-gray-700">{percent}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700 ease-out',
                  isComplete ? 'bg-emerald-400' : 'bg-blue-500',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-2">
            <FolderKanban className="w-3.5 h-3.5" />
            <span>No tasks yet</span>
          </div>
        )}

        {/* Creator badge */}
        {project.creator && (
          <div className="mt-4 flex items-center gap-2 text-xs text-gray-400">
            <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-medium text-gray-500">
              {project.creator.name.charAt(0).toUpperCase()}
            </div>
            <span>{project.creator.name}</span>
          </div>
        )}
      </div>
    </button>
  )
}
