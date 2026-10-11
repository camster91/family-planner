'use client'

import * as React from 'react'
import { ChevronDown, Lock } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { SearchField } from '@/components/ui/search-field'
import { useFeatures } from '@/components/providers/features-provider'
import {
  FEATURES,
  groupFeatures,
  isFeatureEnabled,
  type FeatureKey,
  type FeatureMeta,
} from '@/lib/features'
import { useFeaturesText, type FeaturesMessage } from '@/i18n/features'

const GROUP_ORDER = ['core', 'planning', 'family'] as const
type GroupKey = (typeof GROUP_ORDER)[number]

const GROUP_COPY: Record<
  GroupKey,
  { title: FeaturesMessage; subtitle: FeaturesMessage }
> = {
  core: { title: 'coreTitle', subtitle: 'coreSubtitle' },
  planning: { title: 'planningTitle', subtitle: 'planningSubtitle' },
  family: { title: 'familyTitle', subtitle: 'familySubtitle' },
}

const INITIAL_EXPANDED: Record<GroupKey, boolean> = {
  core: true,
  planning: true,
  family: true,
}

export default function FeaturesPage() {
  const { features, setFeature } = useFeatures()
  const copy = useFeaturesText()
  const [pending, setPending] = React.useState<FeatureKey | null>(null)
  const [toast, setToast] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] =
    React.useState<Record<GroupKey, boolean>>(INITIAL_EXPANDED)
  const [activeGroup, setActiveGroup] = React.useState<GroupKey>('planning')
  const flags = features
  const groups = groupFeatures(FEATURES)
  const normalizedQuery = query.trim().toLocaleLowerCase()

  React.useEffect(() => {
    if (window.matchMedia?.('(max-width: 767px)').matches) {
      setExpanded({ core: false, planning: true, family: false })
    }
  }, [])

  const groupRows = GROUP_ORDER.map((key) => {
    const title = copy(GROUP_COPY[key].title)
    const subtitle = copy(GROUP_COPY[key].subtitle)
    const source = groups[key]
    const matching = normalizedQuery
      ? source.filter((feature) => {
          const needsTitle = feature.requires
            ? FEATURES.find((candidate) => candidate.key === feature.requires)
                ?.title
            : undefined
          return [
            feature.title,
            feature.description,
            title,
            subtitle,
            needsTitle,
          ]
            .filter(Boolean)
            .some((value) =>
              value!.toLocaleLowerCase().includes(normalizedQuery),
            )
        })
      : source
    return { key, title, subtitle, source, features: matching }
  })
  const visibleGroups = normalizedQuery
    ? groupRows.filter((group) => group.features.length > 0)
    : groupRows
  const enabledCount = FEATURES.filter((feature) =>
    isFeatureEnabled(flags, feature.key),
  ).length
  const blockedCount = FEATURES.filter(
    (feature) => feature.requires && !isFeatureEnabled(flags, feature.requires),
  ).length
  const availableCount = FEATURES.filter(
    (feature) =>
      feature.group !== 'core' &&
      (!feature.requires || isFeatureEnabled(flags, feature.requires)),
  ).length
  const hasMatches = visibleGroups.length > 0

  async function toggle(feature: FeatureMeta) {
    if (feature.group === 'core') return
    // A feature whose requirement is off (Rewards/Analytics without Points &
    // streaks, #248) cannot be toggled until that is on.
    if (feature.requires && !isFeatureEnabled(flags, feature.requires)) return
    const next = !flags[feature.key]
    setPending(feature.key)
    try {
      await setFeature(feature.key, next)
      setToast(
        copy(next ? 'enabledToast' : 'disabledToast', { title: feature.title }),
      )
      setTimeout(() => setToast(null), 2200)
    } catch {
      setToast(copy('updateFailed', { title: feature.title }))
      setTimeout(() => setToast(null), 2200)
    } finally {
      setPending(null)
    }
  }

  function toggleGroup(key: GroupKey) {
    setExpanded((current) => ({ ...current, [key]: !current[key] }))
    setActiveGroup(key)
  }

  function jumpToGroup(key: GroupKey) {
    setActiveGroup(key)
    setExpanded((current) => ({ ...current, [key]: true }))
    const section = document.getElementById(`feature-group-${key}`)
    section?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    document
      .getElementById(`feature-group-heading-${key}`)
      ?.focus({ preventScroll: true })
  }

  function setAllGroups(open: boolean) {
    setExpanded({ core: open, planning: open, family: open })
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <LargeHeader
        greeting={copy('greeting')}
        title={copy('title')}
        subtitle={copy('subtitle')}
        className="px-1"
      />

      <div className="space-y-3" aria-label={copy('searchLabel')}>
        <div className="rounded-[var(--radius-lg)] bg-surface-fill-secondary px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-footnote text-label-secondary">
            <span>
              {copy('enabledSummary', {
                enabled: enabledCount,
                total: FEATURES.length,
              })}
            </span>
            <span>
              {copy('availableSummary', { count: availableCount })} ·{' '}
              {copy('blockedSummary', { count: blockedCount })}
            </span>
          </div>
        </div>
        <label className="block">
          <span className="sr-only">{copy('searchLabel')}</span>
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={copy('searchPlaceholder')}
            clearLabel={copy('clearSearch')}
          />
        </label>
        <div className="flex items-center justify-between gap-2">
          <nav
            className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1"
            aria-label={copy('groupNavigation')}
          >
            {groupRows.map((group) => {
              const matchCount = group.features.length
              return (
                <button
                  key={group.key}
                  type="button"
                  className="min-h-11 shrink-0 rounded-full px-3 text-subhead text-label-primary bg-surface-fill hover:bg-surface-fill-secondary focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed disabled:opacity-45"
                  aria-current={activeGroup === group.key ? 'true' : undefined}
                  aria-label={`${group.title} · ${copy('featuresCount', { count: matchCount })}`}
                  disabled={normalizedQuery.length > 0 && matchCount === 0}
                  onClick={() => jumpToGroup(group.key)}
                >
                  {group.title}
                </button>
              )
            })}
          </nav>
          <button
            type="button"
            className="min-h-11 shrink-0 rounded-full px-3 text-subhead text-label-secondary focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            onClick={() =>
              setAllGroups(!Object.values(expanded).every(Boolean))
            }
          >
            {Object.values(expanded).every(Boolean)
              ? copy('closeAll')
              : copy('openAll')}
          </button>
        </div>
      </div>

      {hasMatches ? (
        visibleGroups.map((group) => (
          <FeatureGroup
            key={group.key}
            groupKey={group.key}
            title={group.title}
            subtitle={group.subtitle}
            features={group.features}
            totalCount={group.source.length}
            flags={flags}
            onToggle={toggle}
            pending={pending}
            expanded={normalizedQuery.length > 0 || expanded[group.key]}
            onToggleExpanded={() => toggleGroup(group.key)}
            copy={copy}
          />
        ))
      ) : (
        <div className="rounded-[var(--radius-lg)] bg-surface-fill px-4 py-6 text-center">
          <p className="text-body text-label-primary">{copy('noMatches')}</p>
          <button
            type="button"
            className="mt-3 min-h-11 rounded-full px-4 text-subhead text-label-primary bg-surface-fill-secondary focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
            onClick={() => setQuery('')}
          >
            {copy('clearFilters')}
          </button>
        </div>
      )}

      {toast && (
        <div
          className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-full bg-label-primary text-white text-subhead shadow-[var(--shadow-lg)] animate-spring-in"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function FeatureGroup({
  groupKey,
  title,
  subtitle,
  features,
  totalCount,
  flags,
  onToggle,
  pending,
  expanded,
  onToggleExpanded,
  copy,
}: {
  groupKey: GroupKey
  title: string
  subtitle: string
  features: FeatureMeta[]
  totalCount: number
  flags: Record<FeatureKey, boolean>
  onToggle: (feature: FeatureMeta) => void
  pending: FeatureKey | null
  expanded: boolean
  onToggleExpanded: () => void
  copy: ReturnType<typeof useFeaturesText>
}) {
  const headingId = `feature-group-heading-${groupKey}`
  const panelId = `feature-group-panel-${groupKey}`

  return (
    <section id={`feature-group-${groupKey}`} aria-labelledby={headingId}>
      <div className="flex min-h-11 w-full items-center justify-between gap-3 px-1 pb-2">
        <span className="min-w-0">
          <h2
            id={headingId}
            tabIndex={-1}
            className="text-title-3 focus:outline-none"
          >
            {title}
          </h2>
          <p className="mt-0.5 text-footnote text-label-secondary">
            {subtitle}
          </p>
        </span>
        <button
          type="button"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-full px-2 text-footnote text-label-tertiary focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={
            expanded
              ? copy('hideGroup', { group: title })
              : copy('showGroup', { group: title })
          }
          onClick={onToggleExpanded}
        >
          <span>{copy('featuresCount', { count: totalCount })}</span>
          <ChevronDown
            className={`h-5 w-5 transition-transform ${expanded ? '' : '-rotate-90'}`}
            aria-hidden="true"
          />
        </button>
      </div>
      {expanded && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headingId}
          className="list-inset"
        >
          {features.map((feature, index) => {
            const needs =
              feature.requires && !isFeatureEnabled(flags, feature.requires)
                ? FEATURES.find(
                    (candidate) => candidate.key === feature.requires,
                  )
                : undefined
            return (
              <FeatureRow
                key={feature.key}
                feature={feature}
                enabled={isFeatureEnabled(flags, feature.key)}
                onToggle={() => onToggle(feature)}
                disabled={feature.group === 'core' || needs !== undefined}
                needsTitle={needs?.title}
                pending={pending === feature.key}
                last={index === features.length - 1}
                copy={copy}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function FeatureRow({
  feature,
  enabled,
  onToggle,
  disabled,
  needsTitle,
  pending,
  last,
  copy,
}: {
  feature: FeatureMeta
  enabled: boolean
  onToggle: () => void
  disabled: boolean
  needsTitle?: string
  pending: boolean
  last: boolean
  copy: ReturnType<typeof useFeaturesText>
}) {
  const Icon = feature.icon
  const descriptionId = React.useId()
  const reasonId = React.useId()
  const stateId = React.useId()
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
  const state = pending
    ? copy('updating')
    : feature.group === 'core'
      ? copy('locked')
      : needsTitle
        ? copy('blocked')
        : enabled
          ? copy('on')
          : copy('off')
  return (
    <div
      className={`row-apple ${last ? '' : 'border-b border-[var(--surface-separator)]'}`}
    >
      <div className={`glyph ${bgClass}`}>
        <Icon className="w-5 h-5 text-white" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-body text-label-primary">
          <span className="min-w-0 truncate">{feature.title}</span>
          {disabled && (
            <Lock
              className="h-3.5 w-3.5 shrink-0 text-label-tertiary"
              aria-hidden="true"
            />
          )}
          <span
            id={stateId}
            className="shrink-0 rounded-full bg-surface-fill-secondary px-2 py-0.5 text-caption-1 text-label-secondary"
          >
            {state}
          </span>
        </div>
        <div
          id={descriptionId}
          className="text-footnote text-label-secondary truncate"
        >
          {feature.description}
        </div>
        {needsTitle && (
          <div id={reasonId} className="text-footnote text-label-tertiary">
            {copy('needs', { dependency: needsTitle })}
          </div>
        )}
      </div>
      <ToggleSwitch
        checked={enabled}
        onChange={onToggle}
        disabled={disabled}
        pending={pending}
        featureTitle={feature.title}
        descriptionId={[descriptionId, stateId, needsTitle && reasonId]
          .filter(Boolean)
          .join(' ')}
        copy={copy}
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
  descriptionId,
  copy,
}: {
  checked: boolean
  onChange: () => void
  disabled: boolean
  pending: boolean
  featureTitle?: string
  descriptionId: string
  copy: ReturnType<typeof useFeaturesText>
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={descriptionId}
      aria-label={
        featureTitle
          ? copy(checked ? 'disable' : 'enable', { title: featureTitle })
          : undefined
      }
      aria-disabled={pending || undefined}
      onClick={(event) => {
        if (disabled || pending) {
          event.preventDefault()
          return
        }
        onChange()
      }}
      disabled={disabled}
      className={`group inline-flex h-11 min-w-[51px] shrink-0 items-center justify-center ${disabled || pending ? 'cursor-not-allowed' : 'cursor-pointer'} focus-visible:outline-none`}
    >
      <span
        aria-hidden="true"
        className={`relative block h-[31px] w-[51px] rounded-full transition-colors duration-[var(--duration-fast)] ease-[var(--spring-default)] ${checked ? 'bg-[var(--success)]' : 'bg-[var(--surface-fill-secondary)]'} ${disabled ? 'opacity-50' : 'group-active:opacity-80'} group-focus-visible:shadow-[var(--shadow-focus)]`}
      >
        <span
          className={`absolute left-0 top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-[var(--shadow-sm)] transition-transform duration-[var(--duration-fast)] ease-[var(--spring-default)] ${checked ? 'translate-x-[22px]' : 'translate-x-[2px]'}`}
        >
          {pending && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="block h-3 w-3 rounded-full border-2 border-label-tertiary border-t-transparent animate-spin" />
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
