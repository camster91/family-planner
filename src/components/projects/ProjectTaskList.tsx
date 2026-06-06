'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatDate } from '@/lib/utils'
import { Check } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

export interface ProjectTaskData {
  id: string
  title: string
  description?: string | null
  completed: boolean
  assigned_to?: string | null
  due_date?: string | null
  position: number
  assignee?: {
    id: string
    name: string
    avatar_url?: string | null
  } | null
}

interface ProjectTaskListProps {
  tasks: ProjectTaskData[]
  projectId: string
  projectStatus: 'active' | 'completed' | 'archived'
  familyMembers?: { id: string; name: string }[]
}

export default function ProjectTaskList({
  tasks: initialTasks,
  projectId,
  projectStatus,
  familyMembers = [],
}: ProjectTaskListProps) {
  const [tasks, setTasks] = useState<ProjectTaskData[]>(initialTasks)
  const [loading, setLoading] = useState<string | null>(null)
  const { addToast } = useToast()
  const isReadOnly = projectStatus !== 'active'

  const toggleTask = async (taskId: string, currentCompleted: boolean) => {
    if (isReadOnly) return
    setLoading(taskId)
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !currentCompleted }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update task')

      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed: !currentCompleted } : t)))
      if (!currentCompleted) addToast({ type: 'success', title: 'Task completed!', message: 'Nice work.' })
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to update task', message: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setLoading(null)
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 bg-surface-fill rounded-2xl border border-dashed border-[var(--surface-separator)]">
        <p className="text-subhead text-label-secondary">No tasks yet</p>
        <p className="text-footnote text-label-tertiary mt-1">Break this project into actionable tasks</p>
      </div>
    )
  }

  return (
    <div className="divide-y divide-[var(--surface-separator)]">
      {tasks.map((task) => {
        const isLoading = loading === task.id
        return (
          <div
            key={task.id}
            className={cn(
              'flex items-center gap-3 px-4 py-4 transition-all duration-150',
              task.completed ? 'bg-green-50/50' : 'bg-white',
              isLoading && 'opacity-50 pointer-events-none',
            )}
          >
            {/* Checkbox */}
            <button
              type="button"
              onClick={() => toggleTask(task.id, task.completed)}
              disabled={isReadOnly || isLoading}
              className={cn(
                'shrink-0 w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-all',
                task.completed ? 'bg-success border-success' : 'border-label-tertiary hover:border-success hover:bg-green-50',
                (isReadOnly || isLoading) && 'cursor-not-allowed opacity-60',
              )}
              aria-label={task.completed ? 'Task completed' : 'Mark task complete'}
            >
              {task.completed && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
            </button>

            {/* Title */}
            <div className="flex-1 min-w-0">
              <span className={cn('text-body', task.completed ? 'text-label-tertiary line-through' : 'text-label-primary')}>
                {task.title}
              </span>
              {task.due_date && (
                <p className="text-footnote text-label-secondary mt-0.5">{formatDate(task.due_date)}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}