'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { PAIRING_POLL_MS } from '@/lib/device-client'
import { formatCountdown, waitText } from './use-device-client'
import {
  dangerButtonClass,
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  noticeTextClass,
  primaryButtonClass,
} from './styles'

type Ended = 'expired' | 'cancelled' | 'denied' | 'mismatch'

type Step =
  | { kind: 'label' }
  | { kind: 'code'; pairingId: string; code: string; expiresAt: number }
  | { kind: 'confirm'; pairingId: string; expiresAt: number }
  | { kind: 'connecting'; pairingId: string; expiresAt: number }
  | {
      kind: 'done'
      label: string
      /** From the server: null (nothing replaced), or whether the old tablet is now removed. */
      replaced: { removed: boolean } | null
    }
  | { kind: 'ended'; reason: Ended }

const ENDED_TEXT: Record<Ended, string> = {
  expired: 'This code expired before the tablet connected. Get a new code to try again.',
  cancelled: 'This pairing was cancelled. Get a new code to try again.',
  denied: "Pairing cancelled. The tablet that typed the code can't connect.",
  mismatch: "Too many wrong numbers, so this pairing was cancelled. If it wasn't your tablet, nothing was connected.",
}

async function readError(res: Response) {
  const body = await res.json().catch(() => null)
  const raw = Number.parseInt(res.headers.get('Retry-After') ?? '', 10)
  return {
    code: typeof body?.error?.code === 'string' ? (body.error.code as string) : `HTTP_${res.status}`,
    attemptsLeft: typeof body?.error?.attemptsLeft === 'number' ? (body.error.attemptsLeft as number) : null,
    retryAfter: Number.isFinite(raw) ? raw : null,
  }
}

/**
 * "Pair a tablet" (SHARED_DEVICE.md §5.1 steps 1 and 3): name → one-time
 * code with its expiry countdown → poll until the tablet claims it → "Type
 * the number shown on the tablet" → confirmed → paired. "This isn't my
 * tablet" cancels. With `replace` and the box ticked, the pairing carries
 * `replacesDeviceId`: the server revokes the old tablet in the same
 * transaction that connects the new one (so replacing works at the 5-tablet
 * limit), and the dialog reports the removal only from the server's answer
 * (§7 "Replace").
 */
export default function PairTabletDialog({
  open,
  onClose,
  onPaired,
  replace,
}: {
  open: boolean
  onClose: () => void
  onPaired: () => void
  replace?: { id: string; label: string } | null
}) {
  const [step, setStep] = React.useState<Step>({ kind: 'label' })
  const [label, setLabel] = React.useState('Kitchen tablet')
  const [removeOld, setRemoveOld] = React.useState(true)
  const [digits, setDigits] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const labelRef = React.useRef<HTMLInputElement>(null)
  const digitsRef = React.useRef<HTMLInputElement>(null)
  const labelForDone = React.useRef(label)

  React.useEffect(() => {
    if (open) {
      setStep({ kind: 'label' })
      setLabel(replace ? replace.label : 'Kitchen tablet')
      setRemoveOld(true)
      setDigits('')
      setError(null)
      setBusy(false)
    }
  }, [open, replace])

  const pairingId = step.kind === 'code' || step.kind === 'confirm' || step.kind === 'connecting' ? step.pairingId : null
  const expiresAt = step.kind === 'code' || step.kind === 'confirm' || step.kind === 'connecting' ? step.expiresAt : null
  const polling = step.kind === 'code' || step.kind === 'connecting'

  React.useEffect(() => {
    if (step.kind === 'confirm') digitsRef.current?.focus()
  }, [step.kind])

  // Countdown.
  React.useEffect(() => {
    if (expiresAt === null) return
    setNow(Date.now())
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= expiresAt) setStep({ kind: 'ended', reason: 'expired' })
    }, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])

  const [retryState, setRetryState] = React.useState<'idle' | 'busy' | 'failed'>('idle')

  /** Recovery when the server did not remove the replaced tablet: a plain revoke, checked. */
  const removeOldNow = async () => {
    if (!replace || step.kind !== 'done') return
    setRetryState('busy')
    try {
      const res = await fetch(`/api/family/devices/${encodeURIComponent(replace.id)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'replaced' }),
      })
      if (!res.ok) throw new Error(String(res.status))
      setStep({ ...step, replaced: { removed: true } })
      setRetryState('idle')
    } catch {
      setRetryState('failed')
    }
  }

  // Poll the pairing while waiting for the tablet (claim) or for issue (paired).
  React.useEffect(() => {
    if (!polling || !pairingId) return
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      if (cancelled) return
      let delay = PAIRING_POLL_MS
      try {
        const res = await fetch(`/api/family/devices/pairings/${encodeURIComponent(pairingId)}`, { cache: 'no-store' })
        if (cancelled) return
        if (res.ok) {
          const body = (await res.json()) as {
            status: string
            replaces?: { deviceId: string; removed: boolean } | null
          }
          if (body.status === 'claimed' && step.kind === 'code') {
            setStep({ kind: 'confirm', pairingId, expiresAt: expiresAt ?? Date.now() })
            return
          }
          if (body.status === 'paired') {
            setRetryState('idle')
            setStep({
              kind: 'done',
              label: labelForDone.current,
              replaced: body.replaces ? { removed: body.replaces.removed } : null,
            })
            return
          }
          if (body.status === 'expired' || body.status === 'cancelled') {
            setStep({ kind: 'ended', reason: body.status })
            return
          }
        } else if (res.status === 429) {
          const { retryAfter } = await readError(res)
          delay = Math.max(PAIRING_POLL_MS, (retryAfter ?? 5) * 1000)
        }
      } catch {
        // Offline for a moment: keep polling until the code expires.
      }
      if (!cancelled) timer = window.setTimeout(poll, delay)
    }
    timer = window.setTimeout(poll, PAIRING_POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [polling, pairingId, expiresAt, step.kind])

  const cancelPairing = async (id: string) => {
    await fetch(`/api/family/devices/pairings/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null)
  }

  const close = () => {
    // Closing mid-pairing cancels the code, so it cannot be used later.
    if (pairingId && step.kind !== 'connecting') void cancelPairing(pairingId)
    if (step.kind === 'done' || step.kind === 'connecting') onPaired()
    onClose()
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = label.trim()
    if (!trimmed || trimmed.length > 40) {
      setError('Use 1 to 40 characters for the name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/family/devices/pairings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(replace && removeOld ? { label: trimmed, replacesDeviceId: replace.id } : { label: trimmed }),
      })
      if (res.ok) {
        const body = (await res.json()) as { pairingId: string; code: string; expiresAt: string }
        labelForDone.current = trimmed
        setStep({ kind: 'code', pairingId: body.pairingId, code: body.code, expiresAt: Date.parse(body.expiresAt) })
        return
      }
      const { code, retryAfter } = await readError(res)
      if (code === 'DEVICE_LIMIT_REACHED') {
        setError(
          replace && !removeOld
            ? 'This household already has 5 tablets (or codes waiting). Tick "Remove" above, or remove a tablet first.'
            : 'This household already has 5 tablets (or codes waiting). Remove one first.'
        )
      } else if (replace && res.status === 404) {
        setError(`${replace.label} is no longer in your household. Close this and pair a tablet instead.`)
      } else if (replace && code === 'VALIDATION_ERROR') {
        setError(`${replace.label} was already removed. Close this and pair a tablet instead.`)
      } else if (res.status === 429) {
        setError(`Too many pairing codes. Try again in ${waitText(retryAfter)}.`)
      } else {
        setError('Could not create a code. Try again.')
      }
    } catch {
      setError('Could not reach Family Planner. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (step.kind !== 'confirm') return
    if (!/^\d{4}$/.test(digits)) {
      setError('Type the 4 digits shown on the tablet.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/family/devices/pairings/${encodeURIComponent(step.pairingId)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ digits }),
      })
      if (res.ok) {
        setStep({ kind: 'connecting', pairingId: step.pairingId, expiresAt: step.expiresAt })
        return
      }
      const { code, attemptsLeft } = await readError(res)
      setDigits('')
      if (code === 'PAIRING_DIGITS_MISMATCH') {
        if (attemptsLeft === 0) setStep({ kind: 'ended', reason: 'mismatch' })
        else setError(`That number doesn't match the tablet. ${attemptsLeft ?? 'A few'} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`)
      } else if (code === 'PAIRING_EXPIRED') {
        setStep({ kind: 'ended', reason: 'expired' })
      } else if (code === 'PAIRING_CANCELLED') {
        setStep({ kind: 'ended', reason: 'cancelled' })
      } else {
        setError('Could not confirm. Try again.')
      }
    } catch {
      setError('Could not reach Family Planner. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const deny = async () => {
    if (step.kind !== 'confirm') return
    await cancelPairing(step.pairingId)
    setStep({ kind: 'ended', reason: 'denied' })
  }

  const title =
    step.kind === 'label'
      ? replace
        ? `Replace ${replace.label}`
        : 'Pair a tablet'
      : step.kind === 'code'
        ? 'Enter this code on the tablet'
        : step.kind === 'confirm'
          ? 'Type the number shown on the tablet'
          : step.kind === 'connecting'
            ? 'Connecting'
            : step.kind === 'done'
              ? 'Tablet connected'
              : 'Pairing stopped'

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <Dialog open={open} onClose={close} title={title} testId="pair-dialog" initialFocusRef={step.kind === 'label' ? labelRef : undefined}>
      {step.kind === 'label' && (
        <form onSubmit={create} className="space-y-5" noValidate>
          <p className="text-[16px] leading-snug text-label-secondary">
            The tablet shows your family&apos;s Today board. It never holds anyone&apos;s account.
          </p>
          <div>
            <label htmlFor="pair-label" className={labelClass}>
              Tablet name
            </label>
            <input
              ref={labelRef}
              id="pair-label"
              value={label}
              maxLength={40}
              onChange={(e) => setLabel(e.target.value)}
              className={inputClass}
              autoComplete="off"
            />
          </div>
          {replace && (
            <label className="flex min-h-[44px] items-center gap-3 text-[16px] text-label-primary">
              <input
                type="checkbox"
                checked={removeOld}
                onChange={(e) => setRemoveOld(e.target.checked)}
                className="h-6 w-6"
              />
              Remove {replace.label} when the new one is connected
            </label>
          )}
          {error && (
            <p role="alert" className={errorTextClass}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {busy && <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />}
              Get a code
            </button>
            <button type="button" onClick={close} className={neutralButtonClass}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {step.kind === 'code' && (
        <div className="space-y-5">
          <p className="text-[16px] leading-snug text-label-secondary">
            On the tablet, open <span className="font-semibold text-label-primary">{origin}/device/pair</span> and type
            this code.
          </p>
          <p
            data-testid="pairing-code"
            className="font-mono text-[40px] font-bold leading-none tracking-[0.12em] text-label-primary"
          >
            {step.code}
          </p>
          <p data-testid="pairing-expiry" className="text-[16px] text-label-secondary">
            Expires in {formatCountdown(step.expiresAt - now)}
          </p>
          <p role="status" className="flex items-center gap-2 text-[16px] text-label-primary">
            <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            Waiting for the tablet
          </p>
          <button type="button" onClick={close} className={neutralButtonClass}>
            Cancel
          </button>
        </div>
      )}

      {step.kind === 'confirm' && (
        <form onSubmit={confirm} className="space-y-5" noValidate>
          <p className="text-[16px] leading-snug text-label-secondary">
            A tablet entered your code. It now shows a 4-digit number. Type it here to connect it. If you
            can&apos;t see that tablet, it isn&apos;t yours.
          </p>
          <div>
            <label htmlFor="pair-digits" className={labelClass}>
              Number on the tablet
            </label>
            <input
              ref={digitsRef}
              id="pair-digits"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              autoComplete="off"
              value={digits}
              onChange={(e) => {
                setDigits(e.target.value.replace(/\D/g, '').slice(0, 4))
                setError(null)
              }}
              className={`${inputClass} max-w-[12rem] font-mono text-[28px] tracking-[0.3em]`}
            />
          </div>
          <p data-testid="pairing-expiry" className="text-[16px] text-label-secondary">
            Expires in {formatCountdown(step.expiresAt - now)}
          </p>
          {error && (
            <p role="alert" className={errorTextClass}>
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              Connect tablet
            </button>
            <button type="button" onClick={deny} className={neutralButtonClass}>
              This isn&apos;t my tablet
            </button>
          </div>
        </form>
      )}

      {step.kind === 'connecting' && (
        <p role="status" className="flex items-center gap-2 text-[17px] text-label-primary">
          <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
          Confirmed. Waiting for the tablet to finish connecting.
        </p>
      )}

      {step.kind === 'done' && (
        <div className="space-y-5">
          <p role="status" className={noticeTextClass}>
            {step.label} is connected and showing today&apos;s board.
            {replace && step.replaced?.removed ? ` ${replace.label} was removed.` : ''}
          </p>
          {replace && step.replaced && !step.replaced.removed && (
            <div role="alert" className={`space-y-3 ${errorTextClass}`}>
              <p>
                {retryState === 'failed'
                  ? `${replace.label} still could not be removed. Try again, or remove it from the list.`
                  : `${replace.label} was not removed. Remove it now so it stops showing your family's information.`}
              </p>
              <button
                type="button"
                onClick={() => void removeOldNow()}
                disabled={retryState === 'busy'}
                className={dangerButtonClass}
              >
                Remove {replace.label}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              onPaired()
              onClose()
            }}
            className={primaryButtonClass}
          >
            Done
          </button>
        </div>
      )}

      {step.kind === 'ended' && (
        <div className="space-y-5">
          <p role="alert" className={noticeTextClass}>
            {ENDED_TEXT[step.reason]}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setError(null)
                setDigits('')
                setStep({ kind: 'label' })
              }}
              className={primaryButtonClass}
            >
              Get a new code
            </button>
            <button type="button" onClick={onClose} className={neutralButtonClass}>
              Close
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
