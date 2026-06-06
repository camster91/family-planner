'use client'

import * as React from 'react'
import { Plus, MapPin, Home, Briefcase, GraduationCap, Trash2 } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { MapPin as MapPinIcon } from 'lucide-react'

interface Location {
  id: string
  label: string
  address?: string | null
  is_primary?: boolean
  user_id: string
  user_name?: string
  user_avatar?: string | null
}

const ICON_FOR_LABEL: Record<string, any> = {
  Home: Home,
  Work: Briefcase,
  School: GraduationCap,
}

export default function LocationsPage() {
  return (
    <FeatureGate featureKey="locations">
      <LocationsPageInner />
    </FeatureGate>
  )
}

function LocationsPageInner() {
  const [locations, setLocations] = React.useState<Location[]>([])
  const [loading, setLoading] = React.useState(true)
  const [adding, setAdding] = React.useState(false)
  const [newLabel, setNewLabel] = React.useState('Home')
  const [newAddress, setNewAddress] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/locations', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setLocations(data.locations || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!newLabel.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), address: newAddress.trim() || null }),
      })
      if (res.ok) {
        setNewLabel('Home')
        setNewAddress('')
        setAdding(false)
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this location?')) return
    const res = await fetch(`/api/locations/${id}`, { method: 'DELETE' })
    if (res.ok) load()
  }

  const primary = locations.filter((l) => l.is_primary)
  const others = locations.filter((l) => !l.is_primary)

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <LargeHeader
        greeting="Family"
        title="Locations"
        subtitle="Save the places your family goes — home, school, work."
        trailing={
          !adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="btn-tinted"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          ) : null
        }
      />

      {adding && (
        <form onSubmit={add} className="card-apple p-4 space-y-3 animate-spring-up">
          <div className="flex items-center gap-2">
            <div className="glyph bg-tint-calendar">
              <MapPinIcon className="w-5 h-5 text-white" />
            </div>
            <span className="text-headline">New location</span>
          </div>
          <div>
            <label className="label-apple">Label</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Home, School, Work…"
              className="input-apple"
              autoFocus
            />
          </div>
          <div>
            <label className="label-apple">Address</label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
              placeholder="123 Main St"
              className="input-apple"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setAdding(false); setNewLabel('Home'); setNewAddress('') }}
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
      ) : locations.length === 0 ? (
        <EmptyState
          icon={MapPin}
          glyphColor="calendar"
          title="No locations yet"
          description="Add Home, School, Work, or any place the family goes regularly. You can attach them to pickups and events."
        />
      ) : (
        <>
          {primary.length > 0 && (
            <section>
              <SectionHeader>Home</SectionHeader>
              <InsetList>
                {primary.map((l, i) => (
                  <LocationRow key={l.id} location={l} onRemove={remove} last={i === primary.length - 1} />
                ))}
              </InsetList>
            </section>
          )}
          {others.length > 0 && (
            <section>
              <SectionHeader>Other places</SectionHeader>
              <InsetList>
                {others.map((l, i) => (
                  <LocationRow key={l.id} location={l} onRemove={remove} last={i === others.length - 1} />
                ))}
              </InsetList>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function LocationRow({ location, onRemove, last }: { location: Location; onRemove: (id: string) => void; last: boolean }) {
  const Icon = ICON_FOR_LABEL[location.label] || MapPin
  return (
    <div className={`row-apple ${last ? '' : 'border-b border-[var(--surface-separator)]'}`}>
      <div className="glyph bg-tint-calendar">
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body text-label-primary">{location.label}</div>
        {location.address && (
          <div className="text-footnote text-label-secondary truncate">{location.address}</div>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(location.id)}
        className="p-2 text-label-tertiary active:text-[var(--danger)] transition-colors"
        aria-label="Remove"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}
