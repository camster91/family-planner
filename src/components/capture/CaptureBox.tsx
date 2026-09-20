'use client'

import * as React from 'react'
import { Sparkles, Loader2, Check, X, ListPlus, CalendarDays, ClipboardList } from 'lucide-react'

// Small, focused capture box. One input. Type a phrase, confirm what it understood.
// Deliberately not a chat: there is no conversation, no history, one job.

type DraftKind = 'event' | 'task' | 'listitem'

interface Draft {
  kind: DraftKind
  title: string
  start_time?: string
  end_time?: string
  location?: string
  event_type?: string
  list_name?: string
  confidence: 'high' | 'medium' | 'low'
  note?: string
}

const KIND_LABEL: Record<DraftKind, string> = {
  event: 'Event',
  task: 'Task',
  listitem: 'List item',
}

const KIND_ICON: Record<DraftKind, React.ElementType> = {
  event: CalendarDays,
  task: ClipboardList,
  listitem: ListPlus,
}

function friendlyTime(iso?: string): string {
  if (!iso) return 'no date set'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function CaptureBox() {
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [saved, setSaved] = React.useState<string | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)

  // Is capture set up on this deployment?
  React.useEffect(() => {
    fetch('/api/capture')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.configured === false) setUnavailable(true)
      })
      .catch(() => {})
  }, [])

  async function interpret() {
    const phrase = text.trim()
    if (!phrase) return
    setBusy(true)
    setError(null)
    setSaved(null)
    setDraft(null)
    try {
      const res = await fetch('/api/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: phrase }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not read that')
      setDraft(data.draft)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      if (draft.kind === 'listitem') {
        // Find (or create) a shopping list, then add the item to it.
        const listRes = await fetch('/api/lists')
        const listData = await listRes.json().catch(() => ({ lists: [] }))
        const lists: Array<{ id: string; name: string; type: string }> = listData.lists || []
        let list = lists.find((l) => l.type === 'grocery') || lists[0]

        if (!list) {
          const createRes = await fetch('/api/lists/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Shopping', type: 'grocery' }),
          })
          const created = await createRes.json().catch(() => ({}))
          if (!createRes.ok || !created.list) {
            throw new Error(created.error || 'Could not create a shopping list')
          }
          list = created.list
        }

        const itemRes = await fetch('/api/lists/items/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listId: list.id, content: draft.title, quantity: 1 }),
        })
        if (!itemRes.ok) {
          const d = await itemRes.json().catch(() => ({}))
          throw new Error(d.error || 'Could not add to the list')
        }
      } else {
        const res = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: draft.title,
            start_time: draft.start_time,
            end_time: draft.end_time,
            location: draft.location,
            event_type: draft.event_type || 'other',
          }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error(d.error || 'Could not save')
        }
      }
      setSaved(draft.title)
      setDraft(null)
      setText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (unavailable) {
    return (
      <div className="card-apple p-4 text-subhead text-label-secondary">
        Capture needs an AI key to be set up. Ask an admin to add one.
      </div>
    )
  }

  const KindIcon = draft ? KIND_ICON[draft.kind] : Sparkles

  return (
    <div className="card-apple p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-[var(--accent)]" />
        <h2 className="text-headline">Quick add</h2>
      </div>

      <div className="flex gap-2">
        <input
          className="input-apple flex-1"
          placeholder="dentist Tuesday 3pm, or milk"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) interpret()
          }}
          disabled={busy}
          aria-label="What would you like to add?"
        />
        <button
          className="btn-filled px-4"
          onClick={interpret}
          disabled={busy || !text.trim()}
        >
          {busy && !draft ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Read it'}
        </button>
      </div>

      {error && <p className="text-subhead text-[var(--danger)] mt-3">{error}</p>}

      {saved && (
        <p className="text-subhead text-[var(--success,#059669)] mt-3 flex items-center gap-1">
          <Check className="w-4 h-4" /> Added “{saved}”
        </p>
      )}

      {draft && (
        <div className="mt-4 rounded-xl border border-[var(--separator)] p-3">
          <div className="flex items-center gap-2 text-label-secondary text-footnote mb-1">
            <KindIcon className="w-3.5 h-3.5" />
            {KIND_LABEL[draft.kind]}
            {draft.confidence === 'low' && (
              <span className="text-[var(--danger)]">· not sure, please check</span>
            )}
          </div>

          <p className="text-body font-medium">{draft.title}</p>

          {draft.kind !== 'listitem' && (
            <p className="text-subhead text-label-secondary">
              {friendlyTime(draft.start_time)}
              {draft.location ? ` · ${draft.location}` : ''}
            </p>
          )}

          {draft.note && (
            <p className="text-footnote text-label-secondary mt-1">{draft.note}</p>
          )}

          <div className="flex gap-2 mt-3">
            <button className="btn-filled px-4" onClick={confirm} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Add it'}
            </button>
            <button
              className="btn-plain px-4"
              onClick={() => setDraft(null)}
              disabled={busy}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
