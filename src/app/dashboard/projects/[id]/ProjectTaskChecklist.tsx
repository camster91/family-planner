'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { formatDateOnly } from '@/lib/dates'
import { InsetList } from '@/components/ui/list-row'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { Glyph } from '@/components/ui/glyph'
import { useToast } from '@/components/ui/toast'

export interface ChecklistTask {
  id: string
  title: string
  completed: boolean
  /** ISO string of the date-only due date (UTC midnight), or null. */
  due_date: string | null
}

interface ProjectTaskChecklistProps {
  projectId: string
  tasks: ChecklistTask[]
  /** PATCH /api/projects/[id]/tasks/[taskId] is parent-only and needs an active project. */
  canToggle: boolean
}

/**
 * The project's task list. Ticking a task updates it at once (optimistic),
 * saves through the project task PATCH API and refreshes the server page so
 * the progress card follows; a failed save puts the tick back and says so.
 */
export function ProjectTaskChecklist({ projectId, tasks, canToggle }: ProjectTaskChecklistProps) {
  const router = useRouter()
  const { addToast } = useToast()
  // Local ticks not yet reflected in `tasks`. Cleared when fresh server data arrives.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [prevTasks, setPrevTasks] = useState(tasks)
  if (tasks !== prevTasks) {
    setPrevTasks(tasks)
    setOverrides({})
  }

  const toggle = async (taskId: string, next: boolean) => {
    if (!canToggle || pending[taskId]) return
    setOverrides((o) => ({ ...o, [taskId]: next }))
    setPending((p) => ({ ...p, [taskId]: true }))
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error((data && typeof data.error === 'string' && data.error) || 'Please try again.')
      }
      router.refresh()
    } catch (error) {
      setOverrides((o) => {
        const rest = { ...o }
        delete rest[taskId]
        return rest
      })
      addToast({
        type: 'error',
        title: 'Could not update task',
        message: error instanceof TypeError ? 'Check your connection and try again.' : error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setPending((p) => {
        const rest = { ...p }
        delete rest[taskId]
        return rest
      })
    }
  }

  return (
    <InsetList>
      {tasks.map((task, i) => {
        const checked = overrides[task.id] ?? task.completed
        return (
          <CheckboxRow
            key={task.id}
            checked={checked}
            onChange={(next) => toggle(task.id, next)}
            disabled={!canToggle || !!pending[task.id]}
            title={task.title}
            subtitle={task.due_date ? formatDateOnly(task.due_date, { weekday: 'short', month: 'short', day: 'numeric' }) : undefined}
            glyph={
              <Glyph color="projects" size="sm">
                <span className="text-xs" aria-hidden="true">
                  ✓
                </span>
              </Glyph>
            }
            className={cn(i === tasks.length - 1 && 'border-b-0')}
          />
        )
      })}
    </InsetList>
  )
}
