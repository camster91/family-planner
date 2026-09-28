'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { GROCERY_SECTIONS, grocerySectionLabel, type GrocerySectionId } from '@/lib/grocery-sections'

export interface MoveTarget {
  itemId: string
  content: string
  current: GrocerySectionId
  /** True when the household picked the current section (so "automatic" can undo it). */
  chosen: boolean
}

/**
 * "Move to…" sheet (#273): one 44px+ button per store section, the current one
 * marked in text ("Current"), plus "Use the automatic section" when the
 * household picked it. A bottom sheet on phones (the shared Dialog).
 */
export function MoveToSectionDialog({
  target,
  pending,
  error,
  onPick,
  onClose,
}: {
  target: MoveTarget | null
  pending: boolean
  error: string | null
  onPick: (section: GrocerySectionId | null) => void
  onClose: () => void
}) {
  return (
    <Dialog
      open={target !== null}
      onClose={pending ? undefined : onClose}
      title={target ? `Move “${target.content}”` : 'Move'}
      description="Pick the store section. Your household’s lists will use it for this item from now on."
      testId="move-section-dialog"
    >
      {target && (
        <div className="space-y-3">
          {error && (
            <p role="alert" className="text-subhead text-label-primary">
              {error}
            </p>
          )}
          <ul className="space-y-1" aria-label="Store sections">
            {GROCERY_SECTIONS.map((section) => {
              const isCurrent = section === target.current
              return (
                <li key={section}>
                  <button
                    type="button"
                    disabled={pending}
                    aria-pressed={isCurrent}
                    onClick={() => onPick(section)}
                    className={cn(
                      'flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] px-4 text-left text-body text-label-primary',
                      'hover:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)] disabled:opacity-60',
                      isCurrent && 'bg-[var(--surface-fill-secondary)] font-semibold'
                    )}
                  >
                    <span className="min-w-0 break-words">{grocerySectionLabel(section)}</span>
                    {isCurrent && (
                      <span className="inline-flex shrink-0 items-center gap-1 text-footnote text-label-secondary">
                        <Check className="h-4 w-4" aria-hidden="true" />
                        Current
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {target.chosen && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onPick(null)}
              className="min-h-[44px] w-full rounded-[var(--radius-lg)] px-4 text-left text-subhead text-[var(--accent-text)] underline-offset-2 hover:underline disabled:opacity-60"
            >
              Use the automatic section
            </button>
          )}
        </div>
      )}
    </Dialog>
  )
}
