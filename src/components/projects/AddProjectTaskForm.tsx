'use client'

// "Add task" for an existing project (route inventory F-5, #289): the in-app
// caller of POST /api/projects/[id]/tasks. Shown on an active project only
// (the API refuses completed and archived ones). Any household member may add
// a task, like the API.
//
// Online only: offline the button stays but the form says so and does not
// send. A failed save keeps what was typed and shows the server's reason.

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { useOnline } from '@/components/ui/use-online'
import { useToast } from '@/components/ui/toast'

interface AddProjectTaskFormProps {
  projectId: string
  familyMembers?: { id: string; name: string }[]
}

const FOCUS =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]'

export function AddProjectTaskForm({ projectId, familyMembers = [] }: AddProjectTaskFormProps) {
  const router = useRouter()
  const online = useOnline()
  const { addToast } = useToast()
  const idBase = React.useId()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState('')
  const [dueDate, setDueDate] = React.useState('')
  const [assignee, setAssignee] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const titleRef = React.useRef<HTMLInputElement>(null)
  const openerRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (open) titleRef.current?.focus()
  }, [open])

  const close = () => {
    setOpen(false)
    setError(null)
    // Back to the button that opened the form, so keyboard focus is not lost.
    requestAnimationFrame(() => openerRef.current?.focus())
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('Give the task a name.')
      titleRef.current?.focus()
      return
    }
    if (!online || saving) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          ...(dueDate ? { due_date: dueDate } : {}),
          ...(assignee ? { assigned_to: assignee } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.task) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Please try again.')
      }
      setTitle('')
      setDueDate('')
      setAssignee('')
      addToast({ type: 'success', title: 'Task added', message: `“${data.task.title}” is on the list.` })
      router.refresh()
      titleRef.current?.focus()
    } catch (err) {
      setError(`Couldn't add the task. ${err instanceof Error ? err.message : 'Please try again.'}`)
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--surface-fill)] px-4 text-[15px] font-medium text-label-primary ${FOCUS}`}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        Add task
      </button>
    )
  }

  const titleId = `${idBase}-title`
  const dueId = `${idBase}-due`
  const assigneeId = `${idBase}-assignee`
  const errorId = `${idBase}-error`

  return (
    <form onSubmit={submit} aria-label="Add task" className="card-apple space-y-3 p-4" noValidate>
      {!online && (
        <p role="status" className="rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-3 py-2 text-[15px] text-label-primary">
          You&apos;re offline. You can add tasks again when you&apos;re back online.
        </p>
      )}

      <div>
        <label htmlFor={titleId} className="block text-[15px] font-medium text-label-primary">
          Task
        </label>
        <input
          ref={titleRef}
          id={titleId}
          type="text"
          value={title}
          maxLength={200}
          required
          aria-invalid={error && !title.trim() ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => setTitle(e.target.value)}
          className={`mt-1 min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-transparent px-3 text-[16px] text-label-primary ${FOCUS}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={dueId} className="block text-[15px] font-medium text-label-primary">
            Due date <span className="font-normal text-label-secondary">(optional)</span>
          </label>
          <input
            id={dueId}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={`mt-1 min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-transparent px-3 text-[16px] text-label-primary ${FOCUS}`}
          />
        </div>
        {familyMembers.length > 0 && (
          <div>
            <label htmlFor={assigneeId} className="block text-[15px] font-medium text-label-primary">
              Who&apos;s doing it <span className="font-normal text-label-secondary">(optional)</span>
            </label>
            <select
              id={assigneeId}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className={`mt-1 min-h-[44px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)] bg-transparent px-3 text-[16px] text-label-primary ${FOCUS}`}
            >
              <option value="">Anyone</option>
              {familyMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && (
        <p id={errorId} role="alert" className="text-[15px] text-danger-text">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={!online || saving}
          aria-busy={saving ? true : undefined}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center rounded-full bg-tint-projects px-5 text-[15px] font-medium text-white disabled:opacity-60 ${FOCUS}`}
        >
          {saving ? 'Adding…' : 'Add task'}
        </button>
        <button
          type="button"
          onClick={close}
          className={`inline-flex min-h-[44px] min-w-[44px] items-center rounded-full bg-[var(--surface-fill)] px-5 text-[15px] font-medium text-label-primary ${FOCUS}`}
        >
          Done
        </button>
      </div>
    </form>
  )
}
