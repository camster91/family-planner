'use client'

import { ListImagePicker } from '@/components/lists/ListImagePicker'
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ChevronLeft, ListChecks } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Glyph } from '@/components/ui/glyph'
import { listTypeFilter } from '@/lib/list-type-filter'

// -----------------------------------------------------------------------
// Type config
// -----------------------------------------------------------------------

// 'meal_plan' is no longer offered for new lists (ADR-0007 O-8); meals live in /dashboard/meals.
type ListTypeKey = 'grocery' | 'todo' | 'wishlist' | 'shopping' | 'custom'

interface TypeConfig {
  name: string
  color: 'lists' | 'rewards' | 'meals' | 'family'
  icon: React.ComponentType<{ className?: string }>
}

const TYPE_CONFIG: Record<ListTypeKey, TypeConfig> = {
  grocery: { name: 'Grocery', color: 'lists', icon: ShoppingCartIcon },
  todo: { name: 'To-dos', color: 'rewards', icon: CheckSquareIcon },
  wishlist: { name: 'Wishlist', color: 'family', icon: HeartIcon },
  shopping: { name: 'Shopping', color: 'lists', icon: ShoppingBagIcon },
  custom: { name: 'Custom', color: 'lists', icon: ListChecks },
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  grocery: ShoppingCartIcon,
  todo: CheckSquareIcon,
  wishlist: HeartIcon,
  shopping: ShoppingBagIcon,
}

// -----------------------------------------------------------------------
// Inline SVG icons
// -----------------------------------------------------------------------

function ShoppingCartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  )
}

function CheckSquareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06z" />
    </svg>
  )
}

function ShoppingBagIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}

// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function CreateListForm({ inSheet = false, onBusyChange }: { inSheet?: boolean; onBusyChange?: (busy: boolean) => void } = {}) {
  const router = useRouter()
  const [imageUrl, setImageUrl] = React.useState<string | null>(null)
  const [imageUploading, setImageUploading] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [type, setType] = React.useState<ListTypeKey>('grocery')
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  // Stays set from the first submit until the redirect: a second tap during
  // the request or the success pause must not create a second list.
  const submittingRef = React.useRef(false)
  const busy = loading || !!success || imageUploading
  React.useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
  React.useEffect(() => {
    const requested = listTypeFilter(new URLSearchParams(window.location.search).get('type'))
    if (requested && requested !== 'meal_plan') setType(requested)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || submittingRef.current || imageUploading) return
    submittingRef.current = true
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
    const res = await fetch('/api/lists/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        type,
        image_url: imageUrl ?? undefined,
        description: description?.trim() ? description : undefined,
      }),
    })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create list')

      setSuccess('List created!')
      setTimeout(() => {
        router.push('/dashboard/lists')
        router.refresh()
      }, 1200)
    } catch (err) {
      submittingRef.current = false
      setError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={inSheet ? "" : "max-w-lg mx-auto pb-20"}>
      {!inSheet && <>
      {/* Back */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/lists" className="inline-flex items-center gap-1 text-subhead text-[var(--accent)]">
          <ChevronLeft className="w-4 h-4" />
          <span>Lists</span>
        </Link>
      </div>

      </>}
      <div className={inSheet ? "space-y-6" : "px-4 mt-4 space-y-6"}>
        {!inSheet && <>
        {/* Title */}
        <div>
          <h1 className="text-large-title font-display text-label-primary">New List</h1>
          <p className="text-subhead text-label-secondary mt-1">Create a shared list for your family</p>
        </div>

        </>}
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div role="alert" className="bg-[var(--tint-rewards)]/20 border border-[var(--tint-rewards)]/30 rounded-xl px-4 py-3 text-subhead text-[var(--tint-rewards)]">
              {error}
            </div>
          )}
          {success && (
            <div role="status" className="bg-[var(--tint-lists)]/20 border border-[var(--tint-lists)]/30 rounded-xl px-4 py-3 text-subhead text-[var(--tint-lists)]">
              {success}
            </div>
          )}

          {/* Name */}
          <div>
            <label htmlFor="name" className="text-subhead text-label-secondary mb-2 block">Name</label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekly Groceries"
              autoFocus
              className="input-apple"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="text-subhead text-label-secondary mb-2 block">Description <span className="text-label-tertiary">(optional)</span></label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this list for?"
              rows={2}
              className="input-apple resize-none"
            />
          </div>

          {/* Type selector */}
          <div>
            <label className="text-subhead text-label-secondary mb-3 block">Type</label>
            <div className={inSheet ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
              {(Object.keys(TYPE_CONFIG) as ListTypeKey[]).map((t) => {
                const cfg = TYPE_CONFIG[t]
                const Icon = cfg.icon
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setType(t)}
                    aria-pressed={type === t}
                    disabled={busy}
                    className={cn(
                      'card-apple p-3 flex flex-col items-center gap-2 text-center transition-all',
                      type === t ? 'ring-2 ring-[var(--accent)]' : 'active:scale-95'
                    )}
                  >
                    <Glyph color={cfg.color} size="md">
                      <Icon className="w-5 h-5 text-white" />
                    </Glyph>
                    <span className="text-caption-1 text-label-primary font-medium">{cfg.name}</span>
                    {type === t && (
                      <span className="text-caption-2 text-[var(--accent)] font-medium">Selected</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {type === 'custom' && (
            <p className="text-footnote text-label-secondary">
              A checklist for anything your family needs—packing, school supplies, or weekend plans.
            </p>
          )}

          <ListImagePicker value={imageUrl} onChange={setImageUrl} disabled={loading || !!success} onBusyChange={setImageUploading} />

          {/* Submit */}
          <div className={inSheet ? "sticky bottom-0 bg-[var(--surface-elevated)] pt-3 pb-1" : ""}>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            aria-busy={busy}
            className={cn(
              'btn-filled w-full justify-center py-3',
              (busy || !name.trim()) && 'opacity-50 pointer-events-none'
            )}
          >
            {busy ? (
              <>
                <span className="motion-safe:animate-spin" aria-hidden="true">⟳</span>
                <span className="sr-only">{imageUploading ? "Uploading image" : success ? "List created" : "Creating list"}</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Create List</span>
              </>
            )}
          </button>
          </div>
        </form>
      </div>
    </div>
  )
}