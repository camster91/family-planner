'use client'

import { useState, useCallback, useRef, FormEvent } from 'react'
import { Check, Plus, Trash2, Pencil, User, Calendar, X, CheckCircle2, Clock } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
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
  const [editingTask, setEditingTask] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [addLoading, setAddLoading] = useState(false)
  const { addToast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const isReadOnly = projectStatus !== 'active'

  // Toggle task completion
  const toggleTask = useCallback(
    async (taskId: string, currentCompleted: boolean) => {
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

        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, completed: !currentCompleted } : t)),
        )

        if (!currentCompleted) {
          addToast({ type: 'success', title: 'Task completed!', message: 'Nice work.' })
        }
      } catch (error) {
        addToast({
          type: 'error',
          title: 'Failed to update task',
          message: error instanceof Error ? error.message : 'Please try again.',
        })
      } finally {
        setLoading(null)
      }
    },
    [projectId, isReadOnly, addToast],
  )

  // Delete task
  const deleteTask = useCallback(
    async (taskId: string) => {
      if (isReadOnly) return
      if (!confirm('Delete this task?')) return
      setLoading(taskId)
      try {
        const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: 'DELETE',
        })
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to delete task')
        }
        setTasks((prev) => prev.filter((t) => t.id !== taskId))
        addToast({ type: 'success', title: 'Task deleted' })
      } catch (error) {
        addToast({
          type: 'error',
          title: 'Failed to delete task',
          message: error instanceof Error ? error.message : 'Please try again.',
        })
      } finally {
        setLoading(null)
      }
    },
    [projectId, isReadOnly, addToast],
  )

  // Start editing task title
  const startEditing = (task: ProjectTaskData) => {
    setEditingTask(task.id)
    setEditTitle(task.title)
    setTimeout(() => {
      const el = document.getElementById(`edit-input-${task.id}`)
      el?.focus()
    }, 50)
  }

  // Save edited task title
  const saveEdit = useCallback(
    async (taskId: string) => {
      if (!editTitle.trim()) return
      setLoading(taskId)
      try {
        const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: editTitle.trim() }),
        })
        if (!res.ok) throw new Error('Failed to update task')

        setTasks((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, title: editTitle.trim() } : t)),
        )
        setEditingTask(null)
      } catch (error) {
        addToast({
          type: 'error',
          title: 'Failed to update task',
          message: error instanceof Error ? error.message : 'Please try again.',
        })
      } finally {
        setLoading(null)
      }
    },
    [projectId, editTitle, addToast],
  )

  // Add new task
  const addTask = useCallback(
    async (e: FormEvent) => {
      e.preventDefault()
      if (!newTitle.trim()) return
      setAddLoading(true)
      try {
        const body: Record<string, unknown> = { title: newTitle.trim() }
        if (newAssignee) body.assigned_to = newAssignee
        if (newDueDate) body.due_date = new Date(newDueDate).toISOString()

        const res = await fetch(`/api/projects/${projectId}/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to create task')

        setTasks((prev) => [...prev, data.task])
        setNewTitle('')
        setNewAssignee('')
        setNewDueDate('')
        setShowAddForm(false)
        addToast({ type: 'success', title: 'Task added' })
      } catch (error) {
        addToast({
          type: 'error',
          title: 'Failed to add task',
          message: error instanceof Error ? error.message : 'Please try again.',
        })
      } finally {
        setAddLoading(false)
      }
    },
    [projectId, newTitle, newAssignee, newDueDate, addToast],
  )

  if (tasks.length === 0 && !showAddForm) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
        <CheckCircle2 className="w-12 h-12 text-gray-300 mx-auto mb-3" />
        <h3 className="text-sm font-medium text-gray-500 mb-1">No tasks yet</h3>
        <p className="text-xs text-gray-400 mb-4">Break this project into actionable tasks</p>
        {!isReadOnly && (
          <button
            type="button"
            onClick={() => {
              setShowAddForm(true)
              setTimeout(() => inputRef.current?.focus(), 50)
            }}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add first task
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {/* Task rows */}
      {tasks.map((task) => {
        const isLoading = loading === task.id
        return (
          <div
            key={task.id}
            className={cn(
              'flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-150 group',
              task.completed
                ? 'bg-emerald-50/60'
                : 'bg-white hover:bg-gray-50/80',
              isLoading && 'opacity-50 pointer-events-none',
            )}
          >
            {/* Checkbox */}
            <button
              type="button"
              onClick={() => toggleTask(task.id, task.completed)}
              disabled={isReadOnly || isLoading}
              className={cn(
                'shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
                task.completed
                  ? 'bg-emerald-500 border-emerald-500 cursor-default'
                  : 'border-gray-300 hover:border-emerald-400 hover:bg-emerald-50',
                isReadOnly && 'cursor-not-allowed opacity-60',
              )}
              aria-label={task.completed ? 'Task completed' : 'Mark task complete'}
            >
              {task.completed && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
            </button>

            {/* Title (editable inline) */}
            <div className="flex-1 min-w-0">
              {editingTask === task.id ? (
                <div className="flex items-center gap-2">
                  <input
                    id={`edit-input-${task.id}`}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEdit(task.id)
                      if (e.key === 'Escape') setEditingTask(null)
                    }}
                    onBlur={() => saveEdit(task.id)}
                    className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      saveEdit(task.id)
                    }}
                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      setEditingTask(null)
                    }}
                    className="p-1 text-gray-400 hover:bg-gray-100 rounded"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <span
                  className={cn(
                    'text-sm leading-snug',
                    task.completed ? 'text-gray-400 line-through' : 'text-gray-800',
                  )}
                >
                  {task.title}
                </span>
              )}
            </div>

            {/* Meta badges */}
            <div className="flex items-center gap-2 shrink-0 text-xs text-gray-400">
              {task.due_date && (
                <span className="inline-flex items-center gap-1 text-[11px]">
                  <Calendar className="w-3 h-3" />
                  {formatDate(task.due_date)}
                </span>
              )}

              {task.assignee ? (
                <span
                  className="inline-flex items-center gap-1 bg-gray-100 rounded-full px-2 py-0.5 text-[11px] text-gray-600"
                  title={`Assigned to ${task.assignee.name}`}
                >
                  <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-semibold text-blue-600">
                    {task.assignee.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden sm:inline">{task.assignee.name}</span>
                </span>
              ) : null}
            </div>

            {/* Action buttons */}
            {!isReadOnly && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => startEditing(task)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Edit task"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteTask(task.id)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  aria-label="Delete task"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Add task form */}
      {!isReadOnly && (
        <>
          {showAddForm ? (
            <form onSubmit={addTask} className="flex flex-col gap-2 px-3 py-3 bg-gray-50/50 rounded-xl border border-dashed border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center shrink-0">
                  <Plus className="w-3 h-3 text-gray-400" />
                </div>
                <input
                  ref={inputRef}
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Task name..."
                  className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
                  disabled={addLoading}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 pl-8">
                {/* Assignee selector */}
                {familyMembers.length > 0 && (
                  <select
                    value={newAssignee}
                    onChange={(e) => setNewAssignee(e.target.value)}
                    className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  >
                    <option value="">Anyone</option>
                    {familyMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                )}

                {/* Due date picker */}
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="text-xs bg-white border border-gray-200 rounded-lg px-2 py-1 text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />

                <div className="flex items-center gap-1 ml-auto">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!newTitle.trim() || addLoading}
                    className="px-3 py-1 text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-40 rounded-lg transition-colors"
                  >
                    {addLoading ? 'Adding...' : 'Add'}
                  </button>
                </div>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setShowAddForm(true)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
              className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-xl transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add task
            </button>
          )}
        </>
      )}
    </div>
  )
}
