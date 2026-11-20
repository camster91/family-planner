'use client'

import * as React from 'react'
import { LargeHeader } from '@/components/ui/large-header'
import { useFeatures } from '@/components/providers/features-provider'
import {
  FEATURES,
  isFeatureEnabled,
  type FamilyFeatures,
  type FeatureKey,
  type FeatureMeta,
} from '@/lib/features'
import {
  FEATURE_PAGE_GROUPS,
  FEATURE_PRESET_ORDER,
  matchingPreset,
  planPreset,
  type FeaturePageGroup,
  type FeaturePresetKey,
} from '@/lib/feature-presets'
import { useFeaturesText, type FeaturesMessage } from '@/i18n/features'
import { useFeatureDisplayCopy, type FeatureDisplayCopy } from '@/i18n/feature-display'

type FeaturesCopy = ReturnType<typeof useFeaturesText>

const GROUP_TITLE: Record<FeaturePageGroup, FeaturesMessage> = {
  home: 'homeTitle',
  school: 'schoolTitle',
  kids: 'kidsTitle',
  core: 'alwaysOnTitle',
}

const PRESET_COPY: Record<
  FeaturePresetKey | 'custom',
  { title: FeaturesMessage; description: FeaturesMessage }
> = {
  essentials: { title: 'presetEssentials', description: 'presetEssentialsDescription' },
  school: { title: 'presetSchool', description: 'presetSchoolDescription' },
  everything: { title: 'presetEverything', description: 'presetEverythingDescription' },
  custom: { title: 'presetCustom', description: 'presetCustomDescription' },
}

const META_BY_KEY = new Map<FeatureKey, FeatureMeta>(
  FEATURES.map((feature) => [feature.key, feature]),
)

type PresetStatus =
  | { kind: 'applied'; preset: FeaturePresetKey; undo: Partial<FamilyFeatures> }
  | { kind: 'undone' }
  | { kind: 'failed' }
  | { kind: 'undoFailed'; preset: FeaturePresetKey; undo: Partial<FamilyFeatures> }

/**
 * Features (parent-only route, src/lib/kid-access.ts; the PATCH API refuses
 * anyone else). A "Pick a setup" row sits on top: choosing one shows exactly
 * what turns on and off, applies it in one PATCH, and offers Undo. The full
 * switch list follows in plain groups; core features are listed as always on.
 */
export default function FeaturesPage() {
  const { features, setFeature, updateFeatures, canManage } = useFeatures()
  const copy = useFeaturesText()
  const featureDisplay = useFeatureDisplayCopy()
  const [pendingKeys, setPendingKeys] = React.useState<Set<FeatureKey>>(
    () => new Set(),
  )
  const pendingKeysRef = React.useRef<Set<FeatureKey>>(new Set())
  const [toast, setToast] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<FeaturePresetKey | null>(null)
  const [presetBusy, setPresetBusy] = React.useState(false)
  const [presetStatus, setPresetStatus] = React.useState<PresetStatus | null>(
    null,
  )
  const previewHeadingRef = React.useRef<HTMLHeadingElement>(null)
  const flags = features
  const manage = canManage !== false
  const inUse = matchingPreset(flags)
  const plan = preview ? planPreset(flags, preview) : null
  const selected: FeaturePresetKey | 'custom' = preview ?? inUse ?? 'custom'

  React.useEffect(() => {
    if (preview) previewHeadingRef.current?.focus()
  }, [preview])

  async function toggle(feature: FeatureMeta) {
    if (!manage || presetBusy) return
    if (feature.group === 'core') return
    // A feature whose requirement is off (Rewards/Analytics without Points &
    // streaks, #248) cannot be toggled until that is on.
    if (feature.requires && !isFeatureEnabled(flags, feature.requires)) return
    if (pendingKeysRef.current.has(feature.key)) return
    const next = !flags[feature.key]
    pendingKeysRef.current.add(feature.key)
    setPendingKeys(new Set(pendingKeysRef.current))
    setPresetStatus(null)
    try {
      await setFeature(feature.key, next)
      const title = featureDisplay(feature.key).title
      setToast(copy(next ? 'enabledToast' : 'disabledToast', { title }))
      setTimeout(() => setToast(null), 2200)
    } catch {
      setToast(copy('updateFailed', { title: featureDisplay(feature.key).title }))
      setTimeout(() => setToast(null), 2200)
    } finally {
      pendingKeysRef.current.delete(feature.key)
      setPendingKeys(new Set(pendingKeysRef.current))
    }
  }

  function choosePreset(key: FeaturePresetKey | 'custom') {
    if (presetBusy) return
    setPresetStatus(null)
    if (key === 'custom') {
      setPreview(null)
      const firstGroup = document.getElementById(
        `feature-group-heading-${FEATURE_PAGE_GROUPS[0]!.key}`,
      )
      firstGroup?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
      firstGroup?.focus({ preventScroll: true })
      return
    }
    setPreview(key)
  }

  async function applyPreset() {
    if (!plan || presetBusy || !manage) return
    if (Object.keys(plan.changes).length === 0) return
    setPresetBusy(true)
    try {
      await updateFeatures(plan.changes)
      setPresetStatus({ kind: 'applied', preset: plan.preset, undo: plan.undo })
      setPreview(null)
    } catch {
      setPresetStatus({ kind: 'failed' })
    } finally {
      setPresetBusy(false)
    }
  }

  async function undoPreset() {
    if (
      !presetStatus ||
      (presetStatus.kind !== 'applied' && presetStatus.kind !== 'undoFailed') ||
      presetBusy
    )
      return
    const status = presetStatus
    setPresetBusy(true)
    try {
      await updateFeatures(status.undo)
      setPresetStatus({ kind: 'undone' })
    } catch {
      setPresetStatus({ kind: 'undoFailed', preset: status.preset, undo: status.undo })
    } finally {
      setPresetBusy(false)
    }
  }

  const titles = (keys: FeatureKey[]) =>
    keys.map((key) => featureDisplay(key).title)

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <LargeHeader
        greeting={copy('greeting')}
        title={copy('title')}
        subtitle={copy('subtitle')}
        className="px-1"
      />

      {manage && (
        <section aria-labelledby="feature-presets-heading" className="space-y-3">
          <div className="px-1">
            <h2 id="feature-presets-heading" className="text-title-3">
              {copy('presetsTitle')}
            </h2>
            <p className="mt-0.5 text-footnote text-label-secondary">
              {copy('presetsHint')}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {([...FEATURE_PRESET_ORDER, 'custom'] as const).map((key) => {
              const isSelected = selected === key
              const isInUse = key === 'custom' ? inUse === null : inUse === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={presetBusy}
                  onClick={() => choosePreset(key)}
                  className={`min-h-11 min-w-0 rounded-[var(--radius-lg)] border-2 px-4 py-3 text-left focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] disabled:cursor-not-allowed ${isSelected ? 'border-[var(--accent-fill)] bg-[var(--accent-tint)]' : 'border-transparent bg-surface-fill'}`}
                >
                  <span className="block text-body font-semibold text-label-primary break-words">
                    {copy(PRESET_COPY[key].title)}
                  </span>
                  <span className="mt-0.5 block text-footnote text-label-secondary break-words">
                    {copy(PRESET_COPY[key].description)}
                  </span>
                  {isInUse && (
                    <span className="mt-1 block text-footnote font-semibold text-success-text">
                      {copy('presetInUse')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {plan && (
            <div
              role="region"
              aria-labelledby="feature-preset-preview-heading"
              className="rounded-[var(--radius-lg)] bg-surface-fill-secondary px-4 py-4 space-y-3"
            >
              <h3
                id="feature-preset-preview-heading"
                ref={previewHeadingRef}
                tabIndex={-1}
                className="text-headline text-label-primary focus:outline focus:outline-[3px] focus:outline-offset-2 focus:outline-[var(--accent-text)]"
              >
                {copy('presetPreviewTitle', {
                  preset: copy(PRESET_COPY[plan.preset].title),
                })}
              </h3>
              {plan.turnOn.length === 0 && plan.turnOff.length === 0 ? (
                <p className="text-subhead text-label-secondary">
                  {copy('presetNoChanges')}
                </p>
              ) : (
                <>
                  {plan.turnOn.length > 0 && (
                    <PresetChangeList
                      label={copy('presetTurnsOn')}
                      items={titles(plan.turnOn)}
                    />
                  )}
                  {plan.turnOff.length > 0 && (
                    <PresetChangeList
                      label={copy('presetTurnsOff')}
                      items={titles(plan.turnOff)}
                    />
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary min-h-11"
                  disabled={
                    presetBusy || Object.keys(plan.changes).length === 0
                  }
                  onClick={() => void applyPreset()}
                >
                  {presetBusy ? copy('presetApplying') : copy('presetApply')}
                </button>
                <button
                  type="button"
                  className="btn-secondary min-h-11"
                  disabled={presetBusy}
                  onClick={() => setPreview(null)}
                >
                  {copy('presetCancel')}
                </button>
              </div>
            </div>
          )}

          <div role="status" className="empty:hidden">
            {presetStatus && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-lg)] bg-surface-fill px-4 py-2">
                <span className="min-w-0 text-subhead text-label-primary break-words">
                  {presetStatus.kind === 'applied'
                    ? copy('presetApplied', {
                        preset: copy(PRESET_COPY[presetStatus.preset].title),
                      })
                    : presetStatus.kind === 'undone'
                      ? copy('presetUndone')
                      : presetStatus.kind === 'failed'
                        ? copy('presetFailed')
                        : copy('presetUndoFailed')}
                </span>
                {(presetStatus.kind === 'applied' ||
                  presetStatus.kind === 'undoFailed') && (
                  <button
                    type="button"
                    className="btn-secondary min-h-11"
                    disabled={presetBusy}
                    onClick={() => void undoPreset()}
                  >
                    {copy('presetUndo')}
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {FEATURE_PAGE_GROUPS.map((group) => (
        <section
          key={group.key}
          id={`feature-group-${group.key}`}
          aria-labelledby={`feature-group-heading-${group.key}`}
        >
          <div className="px-1 pb-2">
            <h2
              id={`feature-group-heading-${group.key}`}
              tabIndex={-1}
              className="text-title-3 focus:outline focus:outline-[3px] focus:outline-offset-2 focus:outline-[var(--accent-text)]"
            >
              {copy(GROUP_TITLE[group.key])}
            </h2>
            {group.key === 'core' && (
              <p className="mt-0.5 text-footnote text-label-secondary">
                {copy('alwaysOnSubtitle')}
              </p>
            )}
          </div>
          <div className="list-inset">
            {group.features.map((key, index) => {
              const feature = META_BY_KEY.get(key)!
              const needs =
                feature.requires && !isFeatureEnabled(flags, feature.requires)
                  ? feature.requires
                  : undefined
              return (
                <FeatureRow
                  key={feature.key}
                  feature={feature}
                  enabled={isFeatureEnabled(flags, feature.key)}
                  onToggle={() => void toggle(feature)}
                  disabled={!manage || needs !== undefined}
                  busy={presetBusy}
                  display={featureDisplay(feature.key)}
                  needsTitle={needs ? featureDisplay(needs).title : undefined}
                  pending={pendingKeys.has(feature.key)}
                  last={index === group.features.length - 1}
                  copy={copy}
                />
              )
            })}
          </div>
        </section>
      ))}

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

function PresetChangeList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <p className="text-subhead font-semibold text-label-primary">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-subhead text-label-secondary">
        {items.map((item) => (
          <li key={item} className="break-words">
            {item}
          </li>
        ))}
      </ul>
    </div>
  )
}

const GLYPH_BG: Record<FeatureMeta['glyphColor'], string> = {
  meals: 'bg-tint-meals',
  lists: 'bg-tint-lists',
  family: 'bg-tint-family',
  budget: 'bg-tint-budget',
  rewards: 'bg-tint-rewards',
  projects: 'bg-tint-projects',
  messages: 'bg-tint-messages',
  calendar: 'bg-tint-calendar',
  chore: 'bg-chore',
}

function FeatureRow({
  feature,
  enabled,
  onToggle,
  disabled,
  busy,
  needsTitle,
  display,
  pending,
  last,
  copy,
}: {
  feature: FeatureMeta
  enabled: boolean
  onToggle: () => void
  disabled: boolean
  busy: boolean
  needsTitle?: string
  display: FeatureDisplayCopy
  pending: boolean
  last: boolean
  copy: FeaturesCopy
}) {
  const Icon = feature.icon
  const descriptionId = React.useId()
  const reasonId = React.useId()
  const core = feature.group === 'core'
  return (
    <div
      className={`row-apple ${last ? '' : 'border-b border-[var(--surface-separator)]'}`}
    >
      <div className={`glyph ${GLYPH_BG[feature.glyphColor]}`}>
        <Icon className="w-5 h-5 text-white" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-body text-label-primary break-words leading-tight">
          {display.title}
        </div>
        <div
          id={descriptionId}
          className="text-footnote text-label-secondary break-words"
        >
          {display.description}
        </div>
        {needsTitle && (
          <div id={reasonId} className="text-footnote text-label-tertiary">
            {copy('needs', { dependency: needsTitle })}
          </div>
        )}
        {pending && (
          <div className="text-footnote text-label-tertiary">
            {copy('updating')}
          </div>
        )}
      </div>
      {/* Core rows have no switch: the "Always on" heading says why. */}
      {!core && (
        <ToggleSwitch
          checked={enabled}
          onChange={onToggle}
          disabled={disabled}
          pending={pending}
          busy={busy}
          featureTitle={display.title}
          descriptionId={[descriptionId, needsTitle && reasonId]
            .filter(Boolean)
            .join(' ')}
          copy={copy}
        />
      )}
    </div>
  )
}

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  pending,
  busy,
  featureTitle,
  descriptionId,
  copy,
}: {
  checked: boolean
  onChange: () => void
  disabled: boolean
  pending: boolean
  /** A setup is being applied: hold every switch without a spinner. */
  busy: boolean
  featureTitle: string
  descriptionId: string
  copy: FeaturesCopy
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={descriptionId}
      aria-label={copy(checked ? 'disable' : 'enable', { title: featureTitle })}
      aria-disabled={pending || busy || undefined}
      onClick={(event) => {
        if (disabled || pending || busy) {
          event.preventDefault()
          return
        }
        onChange()
      }}
      disabled={disabled}
      className={`group inline-flex h-11 min-w-[51px] shrink-0 items-center justify-center ${disabled || pending || busy ? 'cursor-not-allowed' : 'cursor-pointer'} focus-visible:outline-none`}
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
