'use client'

import * as React from 'react'
import Link from 'next/link'
import { CircleAlert, Refrigerator } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InventoryText, useInventoryCopy } from '@/app/dashboard/inventory/inventory-copy'
import { expiryFeedback } from '@/i18n/inventory'
import { useTodayBoardText } from '@/i18n/today-board'
import type { UseSoonEntry } from './board-model'
import { Region } from './regions'
import { actionLinkClass, itemTextClass, metaTextClass } from './styles'

/** Rows shown in the "Use soon" tile before "N more". */
export const MAX_USE_SOON_ROWS = 5

/**
 * "Use soon" (#263 data in the slot #262 reserved): food that is expired or
 * should be eaten within a few days. Read-only. The state is always words
 * ("Best before was yesterday", "Use by today", "Best before in 2 days"; a
 * passed use-by day never appears, #158) plus the storage place;
 * expired rows add an icon, never colour alone. Renders nothing when there is
 * nothing to use, so the board keeps its four-column layout.
 */
export function UseSoonRegion({ items, inventoryHref }: { items: UseSoonEntry[]; inventoryHref: string | null }) {
  const inventory = useInventoryCopy()
  const boardText = useTodayBoardText()
  if (items.length === 0) return null
  const shown = items.slice(0, MAX_USE_SOON_ROWS)
  const more = items.length - shown.length
  return (
    <Region
      id="board-usesoon"
      area="usesoon"
      title={inventory('useSoon')}
      icon={Refrigerator}
      glyph="meals"
      action={
        inventoryHref ? (
          <Link href={inventoryHref} className={actionLinkClass}>
            {boardText('openInventory')}
          </Link>
        ) : undefined
      }
    >
      <ul className="divide-y divide-[var(--surface-separator)]">
        {shown.map((item) => (
          <li
            key={item.id}
            data-testid="use-soon-item"
            data-status={item.status}
            className="py-2.5 first:pt-0 2xl:py-3"
          >
            <p className={cn(itemTextClass, 'break-words font-medium md:line-clamp-2')}>{item.name}</p>
            <p className={cn(metaTextClass, 'mt-0.5 flex flex-wrap items-center gap-x-2')}>
              {item.status === 'expired' && (
                <CircleAlert className="h-4 w-4 shrink-0 text-[var(--warning-text)] 2xl:h-5 2xl:w-5" aria-hidden="true" />
              )}
              <span className={item.status === 'expired' ? 'font-semibold text-[var(--warning-text)]' : undefined}>
                <InventoryText feedback={expiryFeedback(item.label)} />
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {item.location === 'fridge' || item.location === 'freezer' || item.location === 'pantry'
                  ? inventory(item.location)
                  : item.location}
              </span>
            </p>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p data-testid="use-soon-more" className={cn(metaTextClass, 'mt-3')}>
          {boardText('moreUseSoon', { count: more })}
        </p>
      )}
    </Region>
  )
}
