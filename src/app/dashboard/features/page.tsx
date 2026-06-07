'use client'

import * as React from 'react'
import { Lock, UtensilsCrossed, StickyNote, Cake, MapPin, Car, Wallet, Gift, TrendingUp, MessageSquare, FolderKanban, CheckSquare, Calendar, ListChecks, Users } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { useFeatures } from '@/components/providers/features-provider'
import { FEATURES, groupFeatures, type FeatureKey, type FeatureMeta } from '@/lib/features'

const GROUP_LABELS: Record<FeatureMeta['group'], { title: string; sub: string }> = {
  core: { title: 'Core', sub: 'Always on. These keep the app working.' },
  planning: { title: 'Planning', sub: 'On by default. Turn off what you do not use.' },
  family: { title: 'Family life', sub: 'Off by default. Turn on to add to your dashboard.' },
}

export default function FeaturesPage() {
  const { features, setFeature } = useFeatures()
  const [pending, setPending] = React.useState<FeatureKey | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)

  const groups = groupFeatures(FEATURES)
  // Local alias to avoid shadowing the FEATURES import in scope.
  const flags = features

  async function toggle(feature: FeatureMeta) {
    if (feature.group === 'core') return
    const next = !flags[feature.key]
    setPending(feature.key)
    try {
      await setFeature(feature.key, next)
      setToast(`${feature.title} ${next ? 'enabled' : 'disabled'}`)
      setTimeout(() => setToast(null), 2200)
    } catch {
      setToast(`Could not update ${feature.title}`)
      setTimeout(() => setToast(null), 2200)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <LargeHeader
        greeting="Family settings"
        title="Features"
        subtitle="Turn features on or off. Disabled features are hidden from the dashboard for everyone."
        className="px-1"
      />

      <FeatureGroup
        title={GROUP_LABELS.core.title}
        subtitle={GROUP_LABELS.core.sub}
        features={groups.core}
        flags={flags}
        onToggle={toggle}
        pending={pending}
      />

      <FeatureGroup
        title={GROUP_LABELS.planning.title}
        subtitle={GROUP_LABELS.planning.sub}
        features={groups.planning}
        flags={flags}
        onToggle={toggle}
        pending={pending}
      />

      <FeatureGroup
        title={GROUP_LABELS.family.title}
        subtitle={GROUP_LABELS.family.sub}
        features={groups.family}
        flags={flags}
        onToggle={toggle}
        pending={pending}
      />

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50
                     px-4 py-2.5 rounded-full bg-label-primary text-white text-subhead
                     shadow-[var(--shadow-lg)] animate-spring-in"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function FeatureGroup({
  title,
  subtitle,
  features,
  flags,
  onToggle,
  pending,
}: {
  title: string
  subtitle: string
  features: FeatureMeta[]
  flags: Record<FeatureKey, boolean>
  onToggle: (f: FeatureMeta) => void
  pending: FeatureKey | null
}) {
  return (
    <section>
      <div className="px-1 pb-2">
        <h2 className="text-title-3">{title}</h2>
        <p className="text-footnote text-label-secondary mt-0.5">{subtitle}</p>
      </div>
      <div className="list-inset">
        {features.map((f, i) => (
          <FeatureRow
            key={f.key}
            feature={f}
            enabled={flags[f.key] === true}
            onToggle={() => onToggle(f)}
            disabled={f.group === 'core'}
            pending={pending === f.key}
            last={i === features.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

function FeatureRow({
  feature,
  enabled,
  onToggle,
  disabled,
  pending,
  last,
}: {
  feature: FeatureMeta
  enabled: boolean
  onToggle: () => void
  disabled: boolean
  pending: boolean
  last: boolean
}) {
  const Icon = feature.icon
  const bgClass = {
    meals: 'bg-tint-meals',
    lists: 'bg-tint-lists',
    family: 'bg-tint-family',
    budget: 'bg-tint-budget',
    rewards: 'bg-tint-rewards',
    projects: 'bg-tint-projects',
    messages: 'bg-tint-messages',
    calendar: 'bg-tint-calendar',
    chore: 'bg-chore',
  }[feature.glyphColor]

  return (
    <div
      className={`row-apple ${last ? '' : 'border-b border-[var(--surface-separator)]'}`}
    >
      <div className={`glyph ${bgClass}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body text-label-primary flex items-center gap-1.5">
          {feature.title}
          {disabled && <Lock className="w-3.5 h-3.5 text-label-tertiary" />}
        </div>
        <div className="text-footnote text-label-secondary truncate">{feature.description}</div>
      </div>
      <ToggleSwitch
        checked={enabled}
        onChange={onToggle}
        disabled={disabled}
        pending={pending}
        featureTitle={feature.title}
      />
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  pending,
  featureTitle,
}: {
  checked: boolean
  onChange: () => void
  disabled: boolean
  pending: boolean
  /** Used to build an aria-label like "Enable Chores" so screen readers announce the toggle. */
  featureTitle?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={featureTitle ? `${checked ? 'Disable' : 'Enable'} ${featureTitle}` : undefined}
      onClick={disabled ? undefined : onChange}
      disabled={disabled || pending}
      className={`
        relative inline-flex h-[31px] w-[51px] shrink-0 rounded-full
        transition-colors duration-[var(--duration-fast)] ease-[var(--spring-default)]
        ${checked ? 'bg-[var(--success)]' : 'bg-[var(--surface-fill-secondary)]'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:opacity-80'}
        focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]
      `}
    >
      <span
        className={`
          absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[var(--shadow-sm)]
          transition-transform duration-[var(--duration-fast)] ease-[var(--spring-default)]
          ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}
        `}
      >
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="block h-3 w-3 rounded-full border-2 border-label-tertiary border-t-transparent animate-spin" />
          </span>
        )}
      </span>
    </button>
  )
}
