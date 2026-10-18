'use client'

import * as React from 'react'
import { Sliders } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { InsetList, ListRow } from '@/components/ui/list-row'
import { SearchField } from '@/components/ui/search-field'
import { useFeatures } from '@/components/providers/features-provider'
import { moreItemsFor, type MoreItem } from '@/lib/nav-items'
import { FEATURES } from '@/lib/features'
import { useFeatureDisplayCopy } from '@/i18n/feature-display'
import { useMoreText } from '@/i18n/more'
import { useFeaturesText, type FeaturesMessage } from '@/i18n/features'

const GROUP_ORDER = ['core', 'planning', 'family'] as const
type MoreGroupKey = (typeof GROUP_ORDER)[number]

const GROUP_COPY: Record<MoreGroupKey, { title: FeaturesMessage; subtitle: FeaturesMessage }> = {
  core: { title: 'coreTitle', subtitle: 'coreSubtitle' },
  planning: { title: 'planningTitle', subtitle: 'planningSubtitle' },
  family: { title: 'familyTitle', subtitle: 'familySubtitle' },
}

function groupFor(item: MoreItem): MoreGroupKey {
  return FEATURES.find((feature) => feature.key === item.key)?.group ?? 'family'
}

/**
 * Explore (#499): Family, Chores and enabled tools in searchable groups. Parents only:
 * /dashboard/family/* is not on the kid allowlist. Turning features on or off
 * stays in Features.
 */
export default function MorePage() {
  const { features } = useFeatures()
  const featureDisplay = useFeatureDisplayCopy()
  const featureSettingsText = useFeaturesText()
  const more = useMoreText()
  const items = moreItemsFor('parent', features, featureDisplay)
  const [query, setQuery] = React.useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredItems = normalizedQuery
    ? items.filter((item) =>
        [item.title, item.description].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        ),
      )
    : items
  const others = items.length - 1
  const groups = GROUP_ORDER.map((key) => ({
    key,
    items: filteredItems.filter((item) => groupFor(item) === key),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="w-full pb-20">
      <LargeHeader
        title={more('title')}
        subtitle={
          others === 0
            ? more('choresOnly')
            : others === 1
              ? more('withOneFeature')
              : more('withFeatures', { count: others })
        }
        className="px-4"
      />

      <div className="px-4 space-y-6" data-testid="more-list">
        <div role="search" aria-label={more('searchLabel')}>
          <div>
            <SearchField
              ariaLabel={more('searchLabel')}
              value={query}
              onChange={setQuery}
              placeholder={more('searchPlaceholder')}
              clearLabel={more('clearSearch')}
            />
          </div>
        </div>

        {groups.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3 md:items-start">
            {groups.map((group) => {
              const copy = GROUP_COPY[group.key]
              return (
                <section key={group.key} className="min-w-0" aria-labelledby={`more-group-${group.key}`}>
                  <h2 id={`more-group-${group.key}`} className="section-header px-1">
                    {featureSettingsText(copy.title)}
                  </h2>
                  <p className="px-1 pb-2 text-footnote text-label-secondary">
                    {featureSettingsText(copy.subtitle)}
                  </p>
                  <InsetList>
                    <ul aria-label={`${featureSettingsText(copy.title)} · ${more('listLabel')}`}>
                      {group.items.map((item, i) => (
                        <li key={item.key}>
                          <ListRow
                            icon={item.icon}
                            glyphColor="plain"
                            title={item.title}
                            subtitle={item.description}
                            href={item.href}
                            last={i === group.items.length - 1}
                          />
                        </li>
                      ))}
                    </ul>
                  </InsetList>
                </section>
              )
            })}
          </div>
        ) : (
          <div role="status" aria-live="polite" className="rounded-[var(--radius-lg)] bg-surface-fill px-4 py-6 text-center">
            <p className="text-body text-label-primary">{more('noMatches')}</p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-full bg-surface-fill-secondary px-4 text-subhead text-label-primary"
              onClick={() => setQuery('')}
            >
              {more('clearFilters')}
            </button>
          </div>
        )}

        <InsetList>
          <ListRow
            icon={Sliders}
            glyphColor="plain"
            title={more('settingsTitle')}
            subtitle={more('settingsDescription')}
            href="/dashboard/features"
            last
          />
        </InsetList>
      </div>
    </div>
  )
}
