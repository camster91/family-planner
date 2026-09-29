'use client'

import * as React from 'react'
import Link from 'next/link'
import { Download } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { downloadMyData } from '@/lib/data-export-client'
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from '@/lib/idempotency-key'
import {
  ACCOUNT_DELETE_PHRASE,
  confirmationMatches,
  type DeletionOptions,
} from '@/lib/account-deletion-shared'

/**
 * Delete account / delete household (docs/product/ACCOUNT_DELETION.md).
 *
 * Built in the page (no browser confirm): it loads what the member may delete
 * (`GET /api/users/deletion`), offers the data export first, then asks for the
 * current password and a typed confirmation: "DELETE" for an account, the
 * household name for a household. The destructive button stays disabled until
 * both are filled in and the typed text matches.
 *
 * - A teen, child, or parent with another parent: deletes their own account
 *   (`DELETE /api/users`).
 * - The only parent: can invite another parent first, or delete the whole
 *   household with every member account (`DELETE /api/family`).
 *
 * The request carries an Idempotency-Key. If the network drops, it is sent
 * again once with the same key; a 401 on that retry means the first request
 * already deleted the account (its session is gone), so it counts as done.
 */

type Phase =
  | { kind: 'loading' }
  | { kind: 'load-error' }
  | { kind: 'ready'; options: DeletionOptions }

export interface DeleteAccountDialogProps {
  open: boolean
  onClose: () => void
  /** After a successful deletion. Defaults to a full navigation to the sign-in page. */
  onDeleted?: (mode: 'account' | 'household') => void
  /**
   * False where only the member's own account may be deleted (the user menu
   * for teens and children): household deletion is never offered, even if the
   * server would allow it.
   */
  allowHousehold?: boolean
}

function defaultOnDeleted(mode: 'account' | 'household') {
  window.location.assign(`/login?deleted=${mode}`)
}

export default function DeleteAccountDialog({
  open,
  onClose,
  onDeleted = defaultOnDeleted,
  allowHousehold = true,
}: DeleteAccountDialogProps) {
  const [phase, setPhase] = React.useState<Phase>({ kind: 'loading' })
  const [password, setPassword] = React.useState('')
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [exportState, setExportState] = React.useState<'idle' | 'working' | 'done' | 'error'>('idle')
  const keyRef = React.useRef<string | null>(null)
  // True while `keyRef` belongs to an attempt whose outcome is unknown (the
  // network dropped twice) or that the server reported as still running. If
  // that attempt went on to delete the account, a later request with the same
  // key is answered 401 (the session is gone): that 401 means "done".
  const pendingRef = React.useRef(false)

  const load = React.useCallback(async () => {
    setPhase({ kind: 'loading' })
    try {
      const res = await fetch('/api/users/deletion', { cache: 'no-store' })
      if (!res.ok) throw new Error('options')
      setPhase({ kind: 'ready', options: (await res.json()) as DeletionOptions })
    } catch {
      setPhase({ kind: 'load-error' })
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    setPassword('')
    setTyped('')
    setError(null)
    setBusy(false)
    setExportState('idle')
    // Keep a key whose request may still have deleted the account.
    if (!pendingRef.current) keyRef.current = null
    void load()
  }, [open, load])

  const options = phase.kind === 'ready' ? phase.options : null
  const householdMode = allowHousehold && Boolean(options?.canDeleteHousehold)
  const blocked = options ? !options.canDeleteAccount && !householdMode : false
  const householdName = options?.household?.name ?? ''
  const expected = householdMode ? householdName : ACCOUNT_DELETE_PHRASE
  const ready = Boolean(options) && !blocked && password.length > 0 && confirmationMatches(typed, expected)

  const handleExport = async () => {
    setExportState('working')
    try {
      await downloadMyData()
      setExportState('done')
    } catch {
      setExportState('error')
    }
  }

  const send = async (key: string): Promise<Response> => {
    const url = householdMode ? '/api/family' : '/api/users'
    const body = householdMode
      ? { familyId: options?.household?.id ?? null, password, confirmation: typed }
      : { password, confirmation: typed }
    return fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', [IDEMPOTENCY_HEADER]: key },
      body: JSON.stringify(body),
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    const mode = householdMode ? 'household' : 'account'
    // One key per confirmed attempt; kept across the network retry below.
    keyRef.current = keyRef.current ?? newIdempotencyKey()
    const earlierAttemptPending = pendingRef.current
    let res: Response | null = null
    let retried = false
    try {
      res = await send(keyRef.current)
    } catch {
      retried = true
      try {
        res = await send(keyRef.current)
      } catch {
        res = null
      }
    }
    if (res && (res.ok || ((retried || earlierAttemptPending) && res.status === 401))) {
      pendingRef.current = false
      onDeleted(mode)
      return
    }
    setBusy(false)
    if (!res) {
      // Unknown outcome: keep the key so the next try cannot run twice.
      pendingRef.current = true
      setError('No connection. Check your connection and try again.')
      return
    }
    const data = await res.json().catch(() => null)
    if (res.status === 409 && data?.error?.code === 'IDEMPOTENCY_IN_PROGRESS') {
      pendingRef.current = true
      setError('Still working on it. Wait a moment, then try again.')
      return
    }
    // A refused request did nothing: the next attempt uses a new key.
    keyRef.current = null
    pendingRef.current = false
    if (res.status === 401) {
      setError('Your session has ended. Sign in again to continue.')
    } else {
      setError(
        typeof data?.error === 'string'
          ? data.error
          : typeof data?.error?.message === 'string'
            ? data.error.message
            : 'Something went wrong. Nothing was deleted.'
      )
    }
  }

  const title = householdMode ? 'Delete household' : 'Delete account'

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} title={title} testId="delete-account-dialog">
      {phase.kind === 'loading' && (
        <p role="status" className="text-[16px] text-label-secondary">
          Loading…
        </p>
      )}

      {phase.kind === 'load-error' && (
        <div className="space-y-4">
          <p role="alert" className="text-[16px] text-[var(--danger-text)]">
            Could not load your account details.
          </p>
          <button type="button" className="btn-tinted min-h-[44px] w-full" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}

      {options && blocked && (
        <div className="space-y-4">
          <p className="text-[16px] text-label-primary">
            {options.isOnlyParent
              ? 'You are the only parent in this household. Delete the household from Settings instead.'
              : 'You are the last member of this household. Ask a parent to delete the household instead.'}
          </p>
          <button type="button" className="btn-tinted min-h-[44px] w-full" onClick={onClose}>
            Close
          </button>
        </div>
      )}

      {options && !blocked && (
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <div className="space-y-2 text-[16px] leading-snug text-label-primary">
            {householdMode ? (
              <>
                <p>
                  You are the only parent in <strong>{householdName}</strong>. Deleting it removes the household and all{' '}
                  {options.household?.memberCount ?? 1}{' '}
                  {options.household?.memberCount === 1 ? 'account' : 'accounts'} in it, with every chore, event,
                  list, meal, note, photo and budget entry. Paired tablets are signed out and calendar connections
                  are disconnected.
                </p>
                <p className="text-label-secondary">
                  To delete only your own account, first{' '}
                  <Link href="/dashboard/family/invite" className="font-semibold text-[var(--accent-text)] underline">
                    invite another parent
                  </Link>
                  .
                </p>
              </>
            ) : (
              <p>
                This deletes your account and signs you out everywhere.
                {options.household
                  ? ' Things you added for the household, like chores, events, lists and meals, stay with it. Your messages, notifications and your own chores are deleted.'
                  : ''}
              </p>
            )}
            <p className="font-semibold">This cannot be undone.</p>
          </div>

          <div className="rounded-[var(--radius-lg)] bg-[var(--surface-fill)] p-4">
            <p className="text-[16px] text-label-primary">Download a copy of your data first.</p>
            <button
              type="button"
              className="btn-tinted mt-3 min-h-[44px] w-full"
              onClick={() => void handleExport()}
              disabled={exportState === 'working'}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {exportState === 'working' ? 'Preparing…' : 'Download my data'}
            </button>
            <p aria-live="polite" className="mt-2 text-[15px] text-label-secondary">
              {exportState === 'done' ? 'Your download has started.' : ''}
              {exportState === 'error' ? 'The download did not work. Try again.' : ''}
            </p>
          </div>

          <div>
            <label htmlFor="delete-account-password" className="label-apple">
              Your password
            </label>
            <input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              className="input-apple"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="delete-account-confirm" className="label-apple">
              {householdMode ? (
                <>
                  Type the household name, <strong>{householdName}</strong>, to confirm
                </>
              ) : (
                <>
                  Type <strong>{ACCOUNT_DELETE_PHRASE}</strong> to confirm
                </>
              )}
            </label>
            <input
              id="delete-account-confirm"
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              className="input-apple"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              disabled={busy}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button type="button" className="btn-ghost min-h-[44px] flex-1" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn-destructive min-h-[44px] flex-1 disabled:opacity-40"
              disabled={!ready || busy}
            >
              {busy ? 'Deleting…' : householdMode ? 'Delete household' : 'Delete my account'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
