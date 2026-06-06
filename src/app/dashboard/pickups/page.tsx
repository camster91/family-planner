'use client'

import * as React from 'react'
import { Plus, Car, Check, Clock, MapPin } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { CheckboxRow } from '@/components/ui/checkbox-row'

interface Pickup {
  id: string
  title: string
  location?: string | null
  pickup_time: string
  completed: boolean
  assigned_to?: string | null
  assignee_name?: string | null
  assignee_avatar?: string | null
  notes?: string | null
}

export default function PickupsPage() {
  return (
    <FeatureGate featureKey="pickups">
      <PickupsPageInner />
    </FeatureGate>
  )
}

function PickupsPageInner() {
  const [pickups, setPickups] = React.useState<Pickup[]>([])
  const [members, setMembers] = React.useState<{ id: string; name: string; avatar_url?: string | null }[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState({ title: '', location: '', pickup_time: '', assigned_to: '', notes: '' })
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [p, f] = await Promise.all([
        fetch('/api/pickups', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/family/members', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ members: [] })),
      ])
      setPickups(p.pickups || [])
      setMembers(f.members || [])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => { load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.title.trim() || !draft.pickup_time) return
    setSaving(true)
    try {
      const res = await fetch('/api/pickups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: draft.title.trim(),
          location: draft.location.trim() || null,
          pickup_time: new Date(draft.pickup_time).toISOString(),
          assigned_to: draft.assigned_to || null,
          notes: draft.notes.trim() || null,
        }),
      })
      if (res.ok) {
        setDraft({ title: '', location: '', pickup_time: '', assigned_to: '', notes: '' })
        setAdding(false)
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggle(id: string, completed: boolean) {
    setPickups((prev) => prev.map((p) => p.id === id ? { ...p, completed } : p))
    await fetch(`/api/pickups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    })
  }

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  }

  const now = new Date()
  const upcoming = pickups.filter((p) => !p.completed && new Date(p.pickup_time) >= now)
  const past = pickups.filter((p) => p.completed || new Date(p.pickup_time) < now)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting="Family"
        title="Pickups"
        subtitle="Coordinate who is doing pickups and when."
        trailing={
          !adding ? (
            <button type="button" onClick={() => setAdding(true)} className="btn-tinted">
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          ) : null
        }
      />

      {adding && (
        <form onSubmit={add} className="card-apple p-4 space-y-3 animate-spring-up">
          <div className="flex items-center gap-2">
            <div className="glyph bg-tint-lists">
              <Car className="w-5 h-5 text-white" />
            </div>
            <span className="text-headline">New pickup</span>
          </div>
          <div>
            <label className="label-apple">Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="School pickup"
              className="input-apple"
              autoFocus
            />
          </div>
          <div>
            <label className="label-apple">When</label>
            <input
              type="datetime-local"
              value={draft.pickup_time}
              onChange={(e) => setDraft({ ...draft, pickup_time: e.target.value })}
              className="input-apple"
            />
          </div>
          <div>
            <label className="label-apple">Location</label>
            <input
              type="text"
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              placeholder="School, 555 King St"
              className="input-apple"
            />
          </div>
          <div>
            <label className="label-apple">Assigned to</label>
            <select
              value={draft.assigned_to}
              onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value })}
              className="input-apple"
            >
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-apple">Notes</label>
            <input
              type="text"
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Bring booster seat"
              className="input-apple"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft({ title: '', location: '', pickup_time: '', assigned_to: '', notes: '' }) }}
              className="btn-plain"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-filled">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="list-inset">
          {[1, 2, 3].map((i) => (
            <div key={i} className="row-apple border-b border-[var(--surface-separator)] last:border-b-0">
              <div className="glyph bg-surface-fill shimmer" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 rounded-full shimmer" />
                <div className="h-2.5 w-48 rounded-full shimmer" />
              </div>
            </div>
          ))}
        </div>
      ) : pickups.length === 0 ? (
        <EmptyState
          icon={Car}
          glyphColor="lists"
          title="No pickups yet"
          description="Add a pickup and assign a family member. Pickups show up on the Today page so no one forgets."
        />
      ) : (
        <>
          {upcoming.length > 0 && (
            <section>
              <SectionHeader>Upcoming</SectionHeader>
              <InsetList>
                {upcoming.map((p, i) => (
                  <PickupRow key={p.id} pickup={p} onToggle={toggle} last={i === upcoming.length - 1} formatTime={formatTime} />
                ))}
              </InsetList>
            </section>
          )}
          {past.length > 0 && (
            <section>
              <SectionHeader>Past</SectionHeader>
              <InsetList>
                {past.map((p, i) => (
                  <PickupRow key={p.id} pickup={p} onToggle={toggle} last={i === past.length - 1} formatTime={formatTime} />
                ))}
              </InsetList>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function PickupRow({
  pickup,
  onToggle,
  last,
  formatTime,
}: {
  pickup: Pickup
  onToggle: (id: string, completed: boolean) => void
  last: boolean
  formatTime: (iso: string) => string
}) {
  return (
    <div className={last ? '' : 'border-b border-[var(--surface-separator)]'}>
      <CheckboxRow
        checked={pickup.completed}
        onChange={(c) => onToggle(pickup.id, c)}
        title={pickup.title}
        subtitle={`${formatTime(pickup.pickup_time)}${pickup.location ? ` · ${pickup.location}` : ''}`}
        glyph={
          pickup.assignee_avatar ? (
            <Avatar name={pickup.assignee_name || '?'} src={pickup.assignee_avatar} size="sm" />
          ) : (
            <div className="glyph bg-tint-lists">
              <Car className="w-5 h-5 text-white" />
            </div>
          )
        }
        meta={pickup.assignee_name || undefined}
      />
    </div>
  )
}
