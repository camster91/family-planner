'use client'

import { Sliders } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { InsetList, ListRow } from '@/components/ui/list-row'
import { useFeatures } from '@/components/providers/features-provider'
import { moreItemsFor } from '@/lib/nav-items'

/**
 * Family → More (#269): every feature that is not a tab, in one list, showing
 * only the ones that are on, plus Chores (which lives on Today). Parents only:
 * /dashboard/family/* is not on the kid allowlist. Turning features on or off
 * stays in Features.
 */
export default function MorePage() {
  const { features } = useFeatures()
  const items = moreItemsFor('parent', features)
  const others = items.length - 1

  return (
    <div className="pb-20 max-w-2xl mx-auto">
      <LargeHeader
        title="More"
        subtitle={
          others === 0
            ? 'Chores, and anything else you turn on, lives here.'
            : `Chores and ${others} more feature${others === 1 ? '' : 's'} your family uses.`
        }
        className="px-4"
      />

      <div className="px-4 space-y-6">
        <InsetList>
          <ul aria-label="Features" data-testid="more-list">
            {items.map((item, i) => (
              <li key={item.key}>
                <ListRow
                  icon={item.icon}
                  glyphColor="plain"
                  title={item.title}
                  subtitle={item.description}
                  href={item.href}
                  last={i === items.length - 1}
                />
              </li>
            ))}
          </ul>
        </InsetList>

        <InsetList>
          <ListRow
            icon={Sliders}
            glyphColor="plain"
            title="Turn features on or off"
            subtitle="Add allowance, pickups, sick days and more"
            href="/dashboard/features"
            last
          />
        </InsetList>
      </div>
    </div>
  )
}
