'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'

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
}

const HOLD_DURATION = 500 // ms

export function LongPressRow({ children, actions, className }: LongPressRowProps) {
  const [open, setOpen] = React.useState(false)
  const holdTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = () => {
    holdTimerRef.current = setTimeout(() => {
      setOpen(true)
    }, HOLD_DURATION)
  }

  const handlePointerUp = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const handlePointerLeave = () => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
  }

  const handleActionClick = (action: Action) => {
    setOpen(false)
    action.onClick()
  }

  return (
    <>
      <div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className={className}
      >
        {children}
      </div>

      {/* Action sheet + scrim */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          {/* Scrim */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />

          {/* Action sheet */}
          <div
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
                onClick={() => setOpen(false)}
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