'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { KeyRound, TabletSmartphone } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  primaryButtonClass,
} from '@/components/device/styles'

async function errorCode(res: Response): Promise<{ code: string; retryAfter: number | null }> {
  const body = await res.json().catch(() => null)
  const code = typeof body?.error?.code === 'string' ? body.error.code : `HTTP_${res.status}`
  const raw = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
  return { code, retryAfter: Number.isFinite(raw) ? raw : null }
}

function minutes(seconds: number | null): string {
  if (!seconds || seconds <= 60) return 'about a minute'
  return `about ${Math.ceil(seconds / 60)} minutes`
}

/**
 * Settings → Privacy & Security entries for shared tablets (#241): the
 * Devices page and the parent's own Tablet PIN (SHARED_DEVICE.md §6.1, §7).
 * Rendered only for parents while the kill switch is on (decided server-side
 * in ./page.tsx).
 */
export default function SharedDeviceSettings({ initialHasPin }: { initialHasPin: boolean }) {
  const [hasPin, setHasPin] = useState(initialHasPin)
  const [pinOpen, setPinOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  return (
    <>
      <Link
        href="/dashboard/settings/devices"
        className="w-full p-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg flex items-center gap-3 min-h-[44px]"
      >
        <TabletSmartphone className="w-4 h-4 text-blue-600" aria-hidden="true" />
        <div>
          <div className="font-medium">Devices</div>
          <div className="text-xs text-gray-500">Pair, rename or remove the family tablet</div>
        </div>
      </Link>

      <div className="w-full p-3 rounded-lg flex flex-wrap items-center gap-3" data-testid="tablet-pin">
        <KeyRound className="w-4 h-4 text-violet-600" aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          <div className="font-medium text-gray-700">Tablet PIN</div>
          <div className="text-xs text-gray-500">
            {hasPin
              ? 'Set. Use it to unlock parent mode on the family tablet.'
              : 'Not set. A 6-digit PIN unlocks parent mode on the family tablet without your password.'}
          </div>
          {message && (
            <p role="status" className="mt-1 text-sm text-gray-700">
              {message}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage(null)
              setPinOpen(true)
            }}
            className={neutralButtonClass}
          >
            {hasPin ? 'Change PIN' : 'Set PIN'}
          </button>
          {hasPin && (
            <button
              type="button"
              onClick={() => {
                setMessage(null)
                setRemoveOpen(true)
              }}
              className={neutralButtonClass}
            >
              Remove PIN
            </button>
          )}
        </div>
      </div>

      <PinDialog
        open={pinOpen}
        change={hasPin}
        onClose={() => setPinOpen(false)}
        onSaved={() => {
          setHasPin(true)
          setPinOpen(false)
          setMessage('Tablet PIN saved.')
        }}
      />

      <Dialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        title="Remove your tablet PIN?"
        description="You can still unlock parent mode on the tablet with your account password."
        testId="remove-pin"
      >
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className={dangerButtonClass}
            onClick={async () => {
              const res = await fetch('/api/users/elevation-pin', { method: 'DELETE' }).catch(() => null)
              setRemoveOpen(false)
              if (res && res.ok) {
                setHasPin(false)
                setMessage('Tablet PIN removed.')
              } else {
                setMessage('Could not remove the PIN. Try again.')
              }
            }}
          >
            Remove PIN
          </button>
          <button type="button" className={neutralButtonClass} onClick={() => setRemoveOpen(false)}>
            Cancel
          </button>
        </div>
      </Dialog>
    </>
  )
}

function PinDialog({
  open,
  change,
  onClose,
  onSaved,
}: {
  open: boolean
  change: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)

  const close = () => {
    setPin('')
    setConfirm('')
    setPassword('')
    setError(null)
    onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6}$/.test(pin)) return setError('The PIN must be exactly 6 digits.')
    if (pin !== confirm) return setError("The two PINs don't match.")
    if (!password) return setError('Enter your current password.')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/users/elevation-pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, currentPassword: password }),
      })
      if (res.ok) {
        setPin('')
        setConfirm('')
        setPassword('')
        onSaved()
        return
      }
      const { code, retryAfter } = await errorCode(res)
      if (code === 'PIN_TOO_WEAK') {
        setError('That PIN is too easy to guess. Avoid repeated digits like 111111 and runs like 123456.')
      } else if (code === 'INVALID_PASSWORD') {
        setError('Your current password is incorrect.')
      } else if (res.status === 429) {
        setError(`Too many PIN changes. Try again in ${minutes(retryAfter)}.`)
      } else {
        setError('Could not save the PIN. Try again.')
      }
    } catch {
      setError('Could not reach Family Planner. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={change ? 'Change tablet PIN' : 'Set tablet PIN'}
      description="Only works on this household's paired tablet. It can't be used to sign in anywhere."
      initialFocusRef={firstRef}
      testId="pin-dialog"
    >
      <form onSubmit={submit} className="space-y-5" noValidate>
        <div>
          <label htmlFor="tablet-pin-new" className={labelClass}>
            New 6-digit PIN
          </label>
          <input
            ref={firstRef}
            id="tablet-pin-new"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tablet-pin-confirm" className={labelClass}>
            Confirm PIN
          </label>
          <input
            id="tablet-pin-confirm"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="off"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tablet-pin-password" className={labelClass}>
            Current password
          </label>
          <input
            id="tablet-pin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </div>
        {error && (
          <p role="alert" className={errorTextClass}>
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            Save PIN
          </button>
          <button type="button" onClick={close} className={neutralButtonClass}>
            Cancel
          </button>
        </div>
      </form>
    </Dialog>
  )
}
