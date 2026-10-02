'use client'

import * as React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Action {
  label: string
  onClick: () => void
  destructive?: boolean
  disabled?: boolean
  icon?: React.ReactNode
}

interface LongPressRowProps {
  children: React.ReactNode
  actions: Action[]
  className?: string
  /** Visible text of the keyboard route to the menu (shown only on focus). */
  menuLabel?: string
  /** What the row is, for screen readers: "More actions for <itemName>". */
  itemName?: string
  /**
   * Always show a trailing "⋯" button that opens the menu, so the actions are
   * discoverable without knowing to press and hold. It replaces the
   * focus-revealed button.
   */
  showMenuButton?: boolean
}

const HOLD_DURATION = 500 // ms

/**
 * A row whose actions open in a bottom action sheet on press and hold.
 *
 * The same menu is reachable without a pointer: a "More actions" button that
 * is visually hidden until it has keyboard focus, the ContextMenu key or
 * Shift+F10 from anything focused inside the row, and a right click. With
 * `showMenuButton` that button is a visible "⋯" at the end of the row. The
 * sheet is a modal dialog: focus moves to its first action, Escape or Cancel
 * closes it, and focus returns to where it was.
 */
export function LongPressRow({
  children,
  actions,
  className,
  menuLabel = 'More actions',
  itemName,
  showMenuButton = false,
}: LongPressRowProps) {
  const [open, setOpen] = React.useState(false)
  const holdTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)
  const sheetRef = React.useRef<HTMLDivElement | null>(null)
  const accessibleName = itemName ? `${menuLabel} for ${itemName}` : menuLabel

  const clearHold = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  React.useEffect(() => clearHold, [])

  const openMenu = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpen(true)
  }

  const closeMenu = React.useCallback(() => {
    setOpen(false)
    const target = returnFocusRef.current
    returnFocusRef.current = null
    // After the sheet unmounts, put focus back where it was, unless the chosen
    // action already moved it (for example by opening a dialog).
    if (target && target.isConnected) {
      setTimeout(() => {
        const active = document.activeElement
        if (!active || active === document.body) target.focus()
      }, 0)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    const sheet = sheetRef.current
    const first = sheet?.querySelector<HTMLButtonElement>('button:not([disabled])')
    first?.focus()
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeMenu()
        return
      }
      if (e.key !== 'Tab' || !sheet) return
      // Keep focus inside the modal sheet.
      const buttons = Array.from(sheet.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
      if (buttons.length === 0) return
      const firstButton = buttons[0]
      const lastButton = buttons[buttons.length - 1]
      if (e.shiftKey && document.activeElement === firstButton) {
        e.preventDefault()
        lastButton.focus()
      } else if (!e.shiftKey && document.activeElement === lastButton) {
        e.preventDefault()
        firstButton.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, closeMenu])

  const handlePointerDown = () => {
    clearHold()
    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null
      openMenu()
    }, HOLD_DURATION)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      openMenu()
    }
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    clearHold()
    openMenu()
  }

  const handleActionClick = (action: Action) => {
    closeMenu()
    action.onClick()
  }

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onPointerCancel={clearHold}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        className={cn('relative', showMenuButton && 'flex items-center', className)}
      >
        {showMenuButton ? (
          <>
            <div className="flex-1 min-w-0">{children}</div>
            <button
              type="button"
              onClick={openMenu}
              // A tap on the button opens the menu at once; it must not also
              // start the row's press-and-hold timer.
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={accessibleName}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={cn(
                'mr-1 w-11 h-11 shrink-0 flex items-center justify-center rounded-full',
                'text-label-secondary active:bg-[var(--surface-fill-secondary)] transition-colors duration-150',
                'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]'
              )}
            >
              <MoreHorizontal className="w-5 h-5" aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            {children}
            <button
              type="button"
              onClick={openMenu}
              aria-label={accessibleName}
              aria-haspopup="dialog"
              aria-expanded={open}
              className={cn(
                'sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:right-2 focus-visible:top-1/2',
                'focus-visible:-translate-y-1/2 focus-visible:min-h-[44px] focus-visible:px-3 focus-visible:rounded-xl',
                'focus-visible:bg-[var(--surface-elevated)] focus-visible:text-[var(--accent)] focus-visible:text-subhead'
              )}
            >
              {menuLabel}
            </button>
          </>
        )}
      </div>

      {/* Action sheet + scrim */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/40" onClick={closeMenu} aria-hidden="true" />

          {/* Action sheet */}
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={accessibleName}
            className={cn(
              'relative z-10 mx-4 mb-6 rounded-2xl overflow-hidden',
              'bg-[var(--surface-elevated)]',
              'animate-spring-up'
            )}
          >
            {/* Action list */}
            <div className="divide-y divide-[var(--surface-border)]">
              {actions.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleActionClick(action)}
                  disabled={action.disabled}
                  className={cn(
                    'w-full px-4 py-4 text-center text-body font-medium',
                    'active:bg-[var(--surface-fill-secondary)]',
                    'transition-colors duration-150',
                    action.disabled && 'opacity-40 pointer-events-none',
                    action.destructive
                      ? 'text-red-500'
                      : 'text-[var(--accent)]'
                  )}
                >
                  {action.label}
                </button>
              ))}
            </div>

            {/* Cancel button */}
            <div className="p-2 border-t border-[var(--surface-border)]">
              <button
                type="button"
                onClick={closeMenu}
                className={cn(
                  'w-full py-3.5 rounded-xl text-body font-semibold text-label-primary',
                  'bg-[var(--surface-fill)] active:bg-[var(--surface-fill-secondary)]',
                  'transition-colors duration-150'
                )}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
