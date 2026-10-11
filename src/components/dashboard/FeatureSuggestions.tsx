'use client'

import * as React from 'react'
import Link from 'next/link'
import { ChevronRight, Gift, MessageSquare, StickyNote, Wallet, type LucideIcon } from 'lucide-react'
import { useFeatures } from '@/components/providers/features-provider'
import { useMaybeToast, useUndoToast } from '@/components/ui/toast'
import { isFeatureEnabled, type FamilyFeatures, type FeatureKey } from '@/lib/features'
import { cn } from '@/lib/utils'
import { useFeatureDisplayCopy } from '@/i18n/feature-display'
import { useFeatureSuggestionsText } from '@/i18n/feature-suggestions'
import { pickFeatureSuggestionKeys } from './feature-suggestion-keys'
import {
  featureSuggestionsStorageKey,
  useFeatureSuggestionsHidden,
  useGetStartedHidden,
  writeVisibilityHidden,
} from './get-started-visibility'

export { featureSuggestionsStorageKey } from './get-started-visibility'

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
  const keys = pickFeatureSuggestionKeys(features, MAX_SUGGESTIONS)
  return FEATURE_SUGGESTIONS.filter((s) => keys.includes(s.key))
}

export interface FeatureSuggestionsProps {
  viewer: { role: string }
  familyId: string
  /** All Get started steps are done (from the server). */
  setupDone: boolean
  /** Captured by the Today wrapper before this optional card is loaded. */
  initialPicked?: readonly FeatureKey[]
}

export default function FeatureSuggestions({ viewer, familyId, setupDone, initialPicked }: FeatureSuggestionsProps) {
  const { features, updateFeatures, canManage } = useFeatures()
  const featureDisplay = useFeatureDisplayCopy()
  const suggestions = useFeatureSuggestionsText()
  const showUndo = useUndoToast()
  const { addToast } = useMaybeToast()
  const getStartedHidden = useGetStartedHidden(familyId)
  const stored = useFeatureSuggestionsHidden(familyId)
  const [hiddenNow, setHiddenNow] = React.useState(false)
  // Chosen once per visit, so a row turned on stays put (as "On" with a link)
  // instead of the list reshuffling under the parent's finger.
  const [picked] = React.useState(() => initialPicked?.slice() ?? pickSuggestions(features).map((s) => s.key))
  const [busy, setBusy] = React.useState<FeatureKey | null>(null)
  const headingId = React.useId()

  if (viewer.role !== 'parent' || !canManage) return null
  if (!setupDone && !getStartedHidden) return null
  if (stored || hiddenNow || picked.length === 0) return null

  const rows = FEATURE_SUGGESTIONS.filter((s) => picked.includes(s.key))

  const fail = (message: string) =>
    addToast({
      type: 'error',
      title: suggestions('updateFailedTitle'),
      message,
    })

  const turnOn = async (s: FeatureSuggestion) => {
    const title = featureDisplay(s.key).title
    const before: Partial<FamilyFeatures> = {}
    for (const k of Object.keys(s.turnOn) as FeatureKey[]) before[k] = features[k]
    setBusy(s.key)
    try {
      await updateFeatures(s.turnOn)
    } catch {
      fail(suggestions('turnOnFailed', { title }))
      return
    } finally {
      setBusy(null)
    }
    showUndo({
      title: suggestions('turnedOn', { title }),
      onUndo: () => {
        updateFeatures(before).catch(() =>
          fail(suggestions('turnOffFailed', { title })),
        )
      },
    })
  }

  const notNow = () => {
    setHiddenNow(true)
    writeVisibilityHidden(featureSuggestionsStorageKey(familyId), true)
    showUndo({
      title: suggestions('hidden'),
      message: suggestions('hiddenMessage'),
      onUndo: () => {
        writeVisibilityHidden(featureSuggestionsStorageKey(familyId), false)
        setHiddenNow(false)
      },
    })
  }

  return (
    <section aria-labelledby={headingId} data-testid="feature-suggestions" className="mb-5 card-apple p-4 md:p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-title-3 text-label-primary">
            {suggestions('heading')}
          </h2>
          <p className="mt-1 text-subhead text-label-secondary">
            {suggestions('description')}
          </p>
        </div>
        <button
          type="button"
          onClick={notNow}
          aria-label={suggestions('hideSuggestions')}
          className="btn-plain -mr-2 -mt-1 min-h-[44px] min-w-[44px] shrink-0"
        >
          {suggestions('hideButton')}
        </button>
      </div>

      <ul className="mt-3 list-inset" aria-label={suggestions('sectionsLabel')}>
        {rows.map((s) => {
          const on = isFeatureEnabled(features, s.key)
          const display = featureDisplay(s.key)
          const Icon = s.icon
          return (
            <li key={s.key} data-testid={`feature-suggestion-${s.key}`} className="row-apple min-h-[60px]">
              <span aria-hidden="true" className={cn('glyph', s.glyph)}>
                <Icon className="h-5 w-5 text-white" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-body text-label-primary">{display.title}</span>
                <span className="block break-words text-footnote text-label-secondary">
                  {on ? suggestions('onForHousehold') : display.description}
                </span>
              </span>
              {on ? (
                <Link
                  href={s.href}
                  aria-label={`${suggestions('open')} ${display.title}`}
                  className="btn-plain min-h-[44px] min-w-[44px] shrink-0"
                >
                  {suggestions('open')}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => turnOn(s)}
                  disabled={busy !== null}
                  aria-label={`${suggestions('turnOn')} ${display.title}`}
                  className="btn-tinted min-h-[44px] shrink-0 px-3"
                >
                  {suggestions('turnOn')}
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
        {suggestions('seeAll')}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  )
}
