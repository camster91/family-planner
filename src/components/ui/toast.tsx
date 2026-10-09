'use client'

import { useState, useEffect, useRef, createContext, useContext, useCallback } from 'react'
import { CheckCircle, AlertCircle, Info, X, Trophy, Flame, Star, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UndoLabel, useToastCopy } from '@/i18n/toast'

type ToastType = 'success' | 'error' | 'info' | 'achievement' | 'streak' | 'levelup' | 'undo'

export interface ToastAction {
  label: React.ReactNode
  onClick: () => void
}

interface Toast {
  id: string
  type: ToastType
  title: React.ReactNode
  message?: React.ReactNode
  duration?: number
  /** One button in the toast (Undo). Pressing it runs the action and dismisses the toast. */
  action?: ToastAction
}

/** How long an Undo toast stays up. The timer pauses while it is hovered or focused. */
export const UNDO_TOAST_MS = 8000

interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}

const NO_TOASTS: ToastContextType = { addToast: () => undefined, removeToast: () => undefined }

/** Like `useToast`, but a no-op outside a ToastProvider (components rendered alone, e.g. in tests). */
export function useMaybeToast(): ToastContextType {
  return useContext(ToastContext) ?? NO_TOASTS
}

/**
 * Undo over confirm (#269): a reversible action runs straight away and offers
 * Undo here instead of asking first with window.confirm. `onUndo` must reverse
 * the action on the server; the caller reports its own failure (an error toast).
 * Only the newest Undo shows: a second one replaces the first (O-42).
 */
export function useUndoToast() {
  const { addToast } = useToast()
  return useCallback(
    (opts: { title: React.ReactNode; message?: React.ReactNode; onUndo: () => void; duration?: number }) =>
      addToast({
        type: 'undo',
        title: opts.title,
        message: opts.message,
        duration: opts.duration ?? UNDO_TOAST_MS,
        action: { label: <UndoLabel />, onClick: opts.onUndo },
      }),
    [addToast]
  )
}

/** Where the toasts sit, and which Undo is up, for pages that keep their end clear of it. */
interface ToastAreaContextType {
  /** Id of the Undo toast showing, or null. A new Undo gets a new id. */
  undoId: string | null
  /** The fixed toast stack (above the phone tab bar). */
  area: React.RefObject<HTMLDivElement | null>
}

const ToastAreaContext = createContext<ToastAreaContextType | null>(null)

/**
 * Opt-in for a page whose end can sit under the Undo card (fixed above the
 * phone tab bar), e.g. kid home with the Rewards card last. While an Undo is
 * showing it returns the room to reserve below the page's content (the toast
 * stack's height plus a gap; 0 otherwise). Once that room is there, if the end
 * of `endRef` is on screen but under the card, the page scrolls just far
 * enough to lift it clear (instantly under reduced motion). A long page whose
 * end is still below the screen is left alone. Other pages are unaffected.
 */
export function useKeepClearOfUndoToast(endRef: React.RefObject<HTMLElement | null>, gap = 12): number {
  const ctx = useContext(ToastAreaContext)
  const undoId = ctx?.undoId ?? null
  const area = ctx?.area
  const [room, setRoom] = useState(0)
  // Bumped when the layout changes under a showing Undo (rotation, rewrap),
  // so the room and the lift below are worked out again.
  const [layout, setLayout] = useState(0)

  // Reserve the room as soon as an Undo shows (and drop it when it goes).
  // Measure again whenever the window or the toast stack changes size: the
  // stack moves between the phone and md+ positions and can rewrap.
  useEffect(() => {
    if (!undoId) {
      setRoom(0)
      return
    }
    const measure = () => {
      setRoom((area?.current?.offsetHeight ?? 0) + gap)
      setLayout((n) => n + 1)
    }
    measure()
    window.addEventListener('resize', measure)
    const stack = area?.current
    const observer = typeof ResizeObserver === 'function' && stack ? new ResizeObserver(measure) : null
    if (observer && stack) observer.observe(stack)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [undoId, area, gap])

  // With the room in place, lift the end of the page above the card if it
  // is under it. Absolute target, so it also wins over a smooth scroll that
  // is still running (the kid celebration's).
  useEffect(() => {
    if (!undoId || room === 0) return
    const frame = requestAnimationFrame(() => {
      const stack = area?.current
      const end = endRef.current
      if (!stack || !end) return
      const stackRect = stack.getBoundingClientRect()
      if (stackRect.height === 0) return
      const endRect = end.getBoundingClientRect()
      // Side by side (the md+ corner toast beside a narrow column): nothing to do.
      if (endRect.right <= stackRect.left || endRect.left >= stackRect.right) return
      const covered = endRect.bottom - (stackRect.top - gap)
      if (covered <= 0 || endRect.bottom > window.innerHeight) return
      const reduce =
        typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      window.scrollTo({ top: window.scrollY + covered, behavior: reduce ? 'auto' : 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [undoId, room, layout, area, endRef, gap])

  return room
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const area = useRef<HTMLDivElement>(null)
  const undoId = toasts.find((t) => t.type === 'undo')?.id ?? null

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    // One Undo at a time (O-42): a new Undo replaces the one showing, so quick
    // ticks never stack cards over the list. The earlier action stays done;
    // only its chance to undo from the toast ends.
    setToasts(prev => [...(toast.type === 'undo' ? prev.filter(t => t.type !== 'undo') : prev), { ...toast, id }])
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      <ToastAreaContext.Provider value={{ undoId, area }}>{children}</ToastAreaContext.Provider>
      {/* Above the phone tab bar; bottom-right from md up, where there is no tab bar. */}
      <div
        ref={area}
        className="fixed inset-x-4 bottom-24 z-[100] flex flex-col gap-2 md:inset-x-auto md:bottom-4 md:right-4 md:max-w-sm"
      >
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const copy = useToastCopy()
  // An actionable toast waits while the pointer or keyboard focus is on it.
  const [paused, setPaused] = useState(false)
  useEffect(() => {
    if (paused && toast.action) return
    const duration = toast.duration || (toast.type === 'achievement' || toast.type === 'levelup' ? 5000 : 3000)
    const timer = setTimeout(onDismiss, duration)
    return () => clearTimeout(timer)
  }, [toast, onDismiss, paused])

  if (toast.type === 'undo') {
    return (
      <div
        className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] py-2 pl-4 pr-2 shadow-lg animate-slide-in"
        role="status"
        aria-live="polite"
        data-testid="undo-toast"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-subhead font-semibold text-label-primary">{toast.title}</p>
          {toast.message && <p className="text-footnote text-label-secondary">{toast.message}</p>}
        </div>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick()
              onDismiss()
            }}
            className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-subhead font-semibold text-[var(--accent-text)] hover:bg-[var(--surface-secondary)]"
          >
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={copy('dismiss')}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-label-tertiary hover:text-label-secondary"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }

  const icons: Record<ToastType, React.ReactNode> = {
    success: <CheckCircle className="w-5 h-5 text-success" />,
    error: <AlertCircle className="w-5 h-5 text-danger-text" />,
    info: <Info className="w-5 h-5 text-primary" />,
    achievement: <Trophy className="w-5 h-5 text-warning-text" />,
    streak: <Flame className="w-5 h-5 text-primary" />,
    levelup: <Star className="w-5 h-5 text-[var(--tint-rewards-text)]" />,
    undo: null,
  }

  const bgColors: Record<ToastType, string> = {
    success: 'border-[var(--success)]',
    error: 'border-[var(--danger)]',
    info: 'border-primary',
    achievement: 'border-[var(--warning)]',
    streak: 'border-[var(--brand-terracotta)]',
    levelup: 'border-[var(--tint-rewards-text)]',
    undo: '',
  }

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-card p-4 shadow-lg animate-slide-in',
        bgColors[toast.type]
      )}
      role="alert"
    >
      <div className="flex-shrink-0 mt-0.5">{icons[toast.type]}</div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-foreground">{toast.title}</p>
        {toast.message && (
          <p className="text-sm text-muted-foreground mt-0.5">{toast.message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={copy('dismiss')}
        className="-my-3 -mr-3 inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-label-tertiary hover:text-muted-foreground"
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  )
}
