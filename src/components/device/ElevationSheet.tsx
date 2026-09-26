'use client'

import * as React from 'react'
import { Delete, KeyRound, Loader2, UserRound } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { DeviceApiError, type DeviceClient, type ElevationSession } from '@/lib/device-client'
import { genericErrorText, waitText, type DeviceMe } from './use-device-client'
import {
  errorTextClass,
  focusRing,
  inputClass,
  labelClass,
  neutralButtonClass,
  noticeTextClass,
  primaryButtonClass,
} from './styles'

const PIN_LENGTH = 6

type Parent = DeviceMe['parents'][number]
type Step = { kind: 'pick' } | { kind: 'pin'; parent: Parent } | { kind: 'password'; parent: Parent }

const keyClass = [
  'flex h-16 min-w-[64px] items-center justify-center rounded-[var(--radius-lg)] text-[28px] font-semibold',
  'bg-[var(--surface-fill)] text-label-primary active:bg-[var(--surface-fill-secondary)] disabled:opacity-50',
  focusRing,
].join(' ')

/**
 * "Parent" on the tablet (SHARED_DEVICE.md §6.2): pick a parent, then their
 * 6-digit tablet PIN (or account password as the fallback). The secret is
 * sent once and never kept; the elevation token lives only in the device
 * client's memory.
 */
export default function ElevationSheet({
  open,
  onClose,
  client,
  parents,
  onElevated,
}: {
  open: boolean
  onClose: () => void
  client: DeviceClient | null
  parents: Parent[]
  onElevated: (session: ElevationSession) => void
}) {
  const [step, setStep] = React.useState<Step>({ kind: 'pick' })
  const [pin, setPin] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const passwordRef = React.useRef<HTMLInputElement>(null)
  const padRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) {
      setStep({ kind: 'pick' })
      setPin('')
      setPassword('')
      setError(null)
      setNotice(null)
      setBusy(false)
    }
  }, [open])

  React.useEffect(() => {
    // Keep focus inside the sheet as the step changes.
    if (step.kind === 'password') passwordRef.current?.focus()
    if (step.kind === 'pin') padRef.current?.querySelector('button')?.focus()
  }, [step])

  const choose = (parent: Parent) => {
    setError(null)
    setPin('')
    setPassword('')
    if (parent.hasPin) {
      setNotice(null)
      setStep({ kind: 'pin', parent })
    } else {
      setNotice(`${parent.name} has no tablet PIN yet, so use the account password. A PIN can be set in Settings on a phone.`)
      setStep({ kind: 'password', parent })
    }
  }

  const submit = async (parent: Parent, method: 'pin' | 'password', secret: string) => {
    if (!client || busy) return
    setBusy(true)
    setError(null)
    try {
      const session = await client.elevate(parent.id, method, secret)
      onElevated(session)
    } catch (err) {
      setPin('')
      setPassword('')
      if (err instanceof DeviceApiError && err.terminal) return
      if (err instanceof DeviceApiError && err.code === 'ELEVATION_INVALID_CREDENTIAL') {
        setError(method === 'pin' ? "That PIN didn't work. Try again." : "That password didn't work. Try again.")
      } else if (err instanceof DeviceApiError && err.code === 'ELEVATION_LOCKED') {
        setNotice(null)
        setError(
          `Too many wrong PIN attempts, so the PIN is locked for ${waitText(err.retryAfterSeconds)}. Use the account password instead.`
        )
        setStep({ kind: 'password', parent })
      } else if (err instanceof DeviceApiError && err.status === 429) {
        setError(`Too many attempts on this tablet. Try again in ${waitText(err.retryAfterSeconds)}.`)
      } else {
        setError(genericErrorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const press = (digit: string) => {
    if (step.kind !== 'pin' || busy) return
    setError(null)
    const next = (pin + digit).slice(0, PIN_LENGTH)
    setPin(next)
    if (next.length === PIN_LENGTH) void submit(step.parent, 'pin', next)
  }

  const backspace = () => setPin((p) => p.slice(0, -1))

  const onPadKey = (e: React.KeyboardEvent) => {
    if (/^\d$/.test(e.key)) {
      e.preventDefault()
      press(e.key)
    } else if (e.key === 'Backspace') {
      e.preventDefault()
      backspace()
    }
  }

  const title =
    step.kind === 'pick'
      ? 'Who is the parent?'
      : step.kind === 'pin'
        ? `${step.parent.name}, enter your tablet PIN`
        : `${step.parent.name}, enter your password`

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      testId="elevation-sheet"
      description={
        step.kind === 'pick' ? 'Parent mode lets you rename or remove this tablet. It ends on its own after 5 minutes idle.' : undefined
      }
    >
      {step.kind === 'pick' && (
        <div className="space-y-3">
          {parents.length === 0 && (
            <p className={noticeTextClass}>No parent in this household can unlock the tablet yet.</p>
          )}
          <ul className="space-y-3">
            {parents.map((parent) => (
              <li key={parent.id}>
                <button
                  type="button"
                  onClick={() => choose(parent)}
                  className={`${neutralButtonClass} w-full justify-start rounded-[var(--radius-lg)] py-3 text-[19px]`}
                >
                  <UserRound className="h-6 w-6 text-label-secondary" aria-hidden="true" />
                  {parent.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step.kind === 'pin' && (
        <div className="space-y-5">
          <div
            ref={padRef}
            role="group"
            aria-label={`Tablet PIN pad for ${step.parent.name}`}
            onKeyDown={onPadKey}
            className="space-y-5"
          >
            <div className="flex justify-center gap-3" aria-hidden="true">
              {Array.from({ length: PIN_LENGTH }, (_, i) => (
                <span
                  key={i}
                  className={[
                    'h-4 w-4 rounded-full border-2 border-[var(--label-primary)]',
                    i < pin.length ? 'bg-[var(--label-primary)]' : 'bg-transparent',
                  ].join(' ')}
                />
              ))}
            </div>
            <p className="sr-only" aria-live="polite" data-testid="pin-progress">
              {pin.length} of {PIN_LENGTH} digits entered
            </p>
            <div className="mx-auto grid max-w-xs grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button key={d} type="button" onClick={() => press(d)} disabled={busy} className={keyClass}>
                  {d}
                </button>
              ))}
              <span aria-hidden="true" />
              <button type="button" onClick={() => press('0')} disabled={busy} className={keyClass}>
                0
              </button>
              <button
                type="button"
                onClick={backspace}
                disabled={busy || pin.length === 0}
                aria-label="Delete last digit"
                className={keyClass}
              >
                <Delete className="h-7 w-7" aria-hidden="true" />
              </button>
            </div>
          </div>
          {busy && (
            <p role="status" className="flex items-center justify-center gap-2 text-[17px] text-label-secondary">
              <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />
              Checking
            </p>
          )}
          {error && (
            <p role="alert" className={errorTextClass}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null)
                setStep({ kind: 'password', parent: step.parent })
              }}
              className={neutralButtonClass}
            >
              <KeyRound className="h-5 w-5" aria-hidden="true" />
              Use password instead
            </button>
            <button type="button" onClick={() => setStep({ kind: 'pick' })} className={neutralButtonClass}>
              Back
            </button>
          </div>
        </div>
      )}

      {step.kind === 'password' && (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            if (password) void submit(step.parent, 'password', password)
          }}
        >
          {notice && <p className={noticeTextClass}>{notice}</p>}
          <div>
            <label htmlFor="elevation-password" className={labelClass}>
              Password for {step.parent.name}
            </label>
            {/* Shared tablet: never offer to save a parent's password here. */}
            <input
              ref={passwordRef}
              id="elevation-password"
              type="password"
              autoComplete="off"
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
            <button type="submit" disabled={busy || !password} className={primaryButtonClass}>
              {busy && <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />}
              Unlock
            </button>
            {step.parent.hasPin && (
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setStep({ kind: 'pin', parent: step.parent })
                }}
                className={neutralButtonClass}
              >
                Use PIN
              </button>
            )}
            <button type="button" onClick={() => setStep({ kind: 'pick' })} className={neutralButtonClass}>
              Back
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
