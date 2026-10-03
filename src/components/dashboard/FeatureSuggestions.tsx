'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, Gift, MessageSquare, StickyNote, Wallet, type LucideIcon } from 'lucide-react'
import { useFeatures } from '@/components/providers/features-provider'
import { useMaybeToast, useUndoToast } from '@/components/ui/toast'
import { isFeatureEnabled, type FamilyFeatures, type FeatureKey } from '@/lib/features'
import { cn } from '@/lib/utils'
import { useGetStartedHidden } from './GetStarted'

/**
 * "Turn on more" (O-38): new households start with six sections on. Once a
 * parent has finished or hidden the Get started card, this calm card offers up
 * to three popular sections that are still off, each with one plain line and
 * a "Turn on" button. Turning one on uses the existing parent-only
 * PATCH /api/family/features (through the features provider, optimistic) and
 * offers Undo. "Not now" hides the card for this household in this browser.
 *
 * Parents only (teens and children cannot change features), never in fridge
 * mode (the Today page leaves it out there).
 */
export interface FeatureSuggestion {
  key: FeatureKey
  title: string
  description: string
  icon: LucideIcon
  glyph: string
  href: string
  /** The flags to set. Rewards needs Points & streaks too. */
  turnOn: Partial<FamilyFeatures>
}

/** In order of preference; the card shows the first three that are off. */
export const FEATURE_SUGGESTIONS: FeatureSuggestion[] = [
  {
    key: 'rewards',
    title: 'Rewards & points',
    description: 'Kids earn points for chores and spend them on rewards you set.',
    icon: Gift,
    glyph: 'bg-tint-rewards',
    href: '/dashboard/rewards',
    turnOn: { gamification: true, rewards: true },
  },
  {
    key: 'budget',
    title: 'Budget',
    description: 'Track shared spending and simple monthly budgets. Parents only.',
    icon: Wallet,
    glyph: 'bg-tint-budget',
    href: '/dashboard/budget',
    turnOn: { budget: true },
  },
  {
    key: 'messages',
    title: 'Family chat',
    description: 'Send messages to your family inside the app.',
    icon: MessageSquare,
    glyph: 'bg-tint-messages',
    href: '/dashboard/messages',
    turnOn: { messages: true },
  },
  {
    key: 'notes',
    title: 'Pinned notes',
    description: 'Quick notes everyone can see, like on the fridge door.',
    icon: StickyNote,
    glyph: 'bg-tint-lists',
    href: '/dashboard/notes',
    turnOn: { notes: true },
  },
]

export const MAX_SUGGESTIONS = 3

/** The suggestions to offer for these flags: popular sections that are off, at most three. */
export function pickSuggestions(features: FamilyFeatures): FeatureSuggestion[] {
  return FEATURE_SUGGESTIONS.filter((s) => !isFeatureEnabled(features, s.key)).slice(0, MAX_SUGGESTIONS)
}

const STORAGE_PREFIX = 'fp:feature-suggestions-hidden:'

export function featureSuggestionsStorageKey(familyId: string): string {
  return `${STORAGE_PREFIX}${familyId}`
}

// Same pattern as GetStarted: per household, in this browser, every storage
// access guarded (private mode or blocked site data just shows it again).
const listeners = new Set<() => void>()

function readHidden(familyId: string): boolean {
  try {
    return window.localStorage.getItem(featureSuggestionsStorageKey(familyId)) === '1'
  } catch {
    return false
  }
}

function writeHidden(familyId: string, hidden: boolean): void {
  try {
    const key = featureSuggestionsStorageKey(familyId)
    if (hidden) window.localStorage.setItem(key, '1')
    else window.localStorage.removeItem(key)
  } catch {
    // Not remembered; it still hides for this visit (see `hiddenNow`).
  }
  listeners.forEach((l) => l())
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

export interface FeatureSuggestionsProps {
  viewer: { role: string }
  familyId: string
  /** All Get started steps are done (from the server). */
  setupDone: boolean
}

export default function FeatureSuggestions({ viewer, familyId, setupDone }: FeatureSuggestionsProps) {
  const { features, updateFeatures, canManage } = useFeatures()
  const showUndo = useUndoToast()
  const { addToast } = useMaybeToast()
  const getStartedHidden = useGetStartedHidden(familyId)
  const stored = React.useSyncExternalStore(
    subscribe,
    () => readHidden(familyId),
    () => false
  )
  const [hiddenNow, setHiddenNow] = React.useState(false)
  // Chosen once per visit, so a row turned on stays put (as "On" with a link)
  // instead of the list reshuffling under the parent's finger.
  const [picked] = React.useState(() => pickSuggestions(features).map((s) => s.key))
  const [busy, setBusy] = React.useState<FeatureKey | null>(null)
  const headingId = React.useId()

  if (viewer.role !== 'parent' || !canManage) return null
  if (!setupDone && !getStartedHidden) return null
  if (stored || hiddenNow || picked.length === 0) return null

  const rows = FEATURE_SUGGESTIONS.filter((s) => picked.includes(s.key))

  const fail = (title: string) =>
    addToast({ type: 'error', title, message: 'Please try again.' })

  const turnOn = async (s: FeatureSuggestion) => {
    const before: Partial<FamilyFeatures> = {}
    for (const k of Object.keys(s.turnOn) as FeatureKey[]) before[k] = features[k]
    setBusy(s.key)
    try {
      await updateFeatures(s.turnOn)
    } catch {
      fail(`Could not turn on ${s.title}`)
      return
    } finally {
      setBusy(null)
    }
    showUndo({
      title: `${s.title} turned on`,
      onUndo: () => {
        updateFeatures(before).catch(() => fail(`Could not turn off ${s.title}`))
      },
    })
  }

  const notNow = () => {
    setHiddenNow(true)
    writeHidden(familyId, true)
    showUndo({
      title: 'Suggestions hidden',
      message: 'You can turn sections on any time in Features.',
      onUndo: () => {
        writeHidden(familyId, false)
        setHiddenNow(false)
      },
    })
  }

  return (
    <section aria-labelledby={headingId} data-testid="feature-suggestions" className="mb-5 card-apple p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-title-3 text-label-primary">
            Turn on more
          </h2>
          <p className="mt-1 text-subhead text-label-secondary">
            Your household starts simple. Add a section when it would help.
          </p>
        </div>
        <button
          type="button"
          onClick={notNow}
          aria-label="Not now, hide suggestions"
          className="btn-plain -mr-2 -mt-1 min-h-[44px] min-w-[44px] shrink-0"
        >
          Not now
        </button>
      </div>

      <ul className="mt-3 list-inset" aria-label="Sections you can turn on">
        {rows.map((s) => {
          const on = isFeatureEnabled(features, s.key)
          const Icon = s.icon
          return (
            <li key={s.key} data-testid={`feature-suggestion-${s.key}`} className="row-apple min-h-[60px]">
              <span aria-hidden="true" className={cn('glyph', s.glyph)}>
                <Icon className="h-5 w-5 text-white" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-body text-label-primary">{s.title}</span>
                <span className="block break-words text-footnote text-label-secondary">
                  {on ? 'On for your household' : s.description}
                </span>
              </span>
              {on ? (
                <Link
                  href={s.href}
                  aria-label={`Open ${s.title}`}
                  className="btn-plain min-h-[44px] min-w-[44px] shrink-0"
                >
                  Open
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => turnOn(s)}
                  disabled={busy !== null}
                  aria-label={`Turn on ${s.title}`}
                  className="btn-tinted min-h-[44px] shrink-0 px-3"
                >
                  Turn on
                </button>
              )}
            </li>
          )
        })}
      </ul>

      <Link
        href="/dashboard/features"
        className="mt-2 inline-flex min-h-[44px] items-center gap-1 text-subhead text-[var(--accent-text)]"
      >
        See all features
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  )
}
