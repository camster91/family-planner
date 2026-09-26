'use client'

import * as React from 'react'
import { Loader2, TabletSmartphone } from 'lucide-react'
import { DeviceApiError, formatCodeInput, isCompleteCode, PAIRING_POLL_MS } from '@/lib/device-client'
import { formatCountdown, genericErrorText, useDeviceClient, waitText } from './use-device-client'
import {
  errorTextClass,
  inputClass,
  labelClass,
  neutralButtonClass,
  primaryButtonClass,
  screenCardClass,
} from './styles'

type PairState =
  | { kind: 'enter' }
  | { kind: 'waiting'; digits: string; expiresAt: number }
  | { kind: 'paired'; label: string }
  | { kind: 'expired' }
  | { kind: 'cancelled' }
  | { kind: 'device_limit' }

function platform(): 'android' | 'web' {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return cap?.isNativePlatform?.() ? 'android' : 'web'
}

const ENDED_COPY: Record<'expired' | 'cancelled' | 'device_limit', { title: string; body: string }> = {
  expired: {
    title: 'This code has expired',
    body: 'Pairing codes last 10 minutes. Ask a parent for a new code, then enter it here.',
  },
  cancelled: {
    title: 'Pairing was cancelled',
    body: "The parent cancelled this pairing, or the number didn't match. Ask a parent for a new code.",
  },
  device_limit: {
    title: 'This household has too many tablets',
    body: 'A household can have 5 tablets. A parent can remove one in Settings, then pair this tablet again.',
  },
}

/**
 * Unpaired tablet (/device/pair, SHARED_DEVICE.md §5.1 steps 2 and 4): enter
 * the parent's code, show the 4 confirmation digits large, poll every 3 s
 * until paired, expired or cancelled. The claim token stays in memory.
 */
export default function PairScreen() {
  const client = useDeviceClient()
  const [state, setState] = React.useState<PairState>({ kind: 'enter' })
  const [code, setCode] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())
  const headingRef = React.useRef<HTMLHeadingElement>(null)

  // Move focus to the new heading when the step changes (screen readers hear the new state).
  const firstRender = React.useRef(true)
  React.useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    headingRef.current?.focus()
  }, [state.kind])

  const waiting = state.kind === 'waiting' ? state : null

  // Poll the pairing status while waiting for the parent.
  React.useEffect(() => {
    if (!client || !waiting) return
    let cancelled = false
    let timer: number | undefined
    const poll = async () => {
      if (cancelled) return
      if (Date.now() >= waiting.expiresAt) {
        client.clearClaim()
        setState({ kind: 'expired' })
        return
      }
      let delay = PAIRING_POLL_MS
      try {
        const result = await client.pollPairing()
        if (cancelled) return
        switch (result.status) {
          case 'paired':
            setState({ kind: 'paired', label: result.device.label })
            // A full load, so the board page sees the new device cookies.
            window.location.replace('/device/today')
            return
          case 'expired':
          case 'cancelled':
          case 'device_limit':
            setState({ kind: result.status })
            return
          case 'rate_limited':
            delay = Math.max(PAIRING_POLL_MS, (result.retryAfterSeconds ?? 5) * 1000)
            break
          default:
            break
        }
      } catch {
        // Offline or a server blip: keep waiting until the code expires.
      }
      if (!cancelled) timer = window.setTimeout(poll, delay)
    }
    timer = window.setTimeout(poll, PAIRING_POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [client, waiting])

  // Countdown clock for the waiting step.
  React.useEffect(() => {
    if (!waiting) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [waiting])

  const complete = isCompleteCode(code)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!client || busy) return
    if (!complete) {
      setError('Pairing codes have 8 letters and numbers, like ABCD-2345.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const claimed = await client.claim(code, platform(), 'web')
      setState({ kind: 'waiting', digits: claimed.confirmDigits, expiresAt: claimed.expiresAt })
    } catch (err) {
      if (err instanceof DeviceApiError && err.code === 'PAIRING_CODE_INVALID') {
        setError('That code did not work. Check it and try again, or ask a parent for a new code.')
      } else if (err instanceof DeviceApiError && err.status === 429) {
        setError(`Too many tries from this tablet. Wait ${waitText(err.retryAfterSeconds)}, then try again.`)
      } else if (err instanceof DeviceApiError && err.status === 404) {
        setError('Tablet mode is not available right now.')
      } else {
        setError(genericErrorText(err))
      }
    } finally {
      setBusy(false)
    }
  }

  const restart = () => {
    client?.clearClaim()
    setCode('')
    setError(null)
    setState({ kind: 'enter' })
  }

  const headingClass =
    'font-display text-[32px] font-bold leading-tight text-label-primary outline-none md:text-[40px]'

  return (
    <main
      data-testid="device-pair"
      data-state={state.kind}
      className="flex min-h-screen items-center justify-center bg-[var(--surface-grouped)] px-4 py-10"
    >
      <div className={screenCardClass}>
        <TabletSmartphone className="h-12 w-12 text-accent" aria-hidden="true" />

        {state.kind === 'enter' && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className={`mt-5 ${headingClass}`}>
              Connect this tablet
            </h1>
            <p className="mt-3 text-[19px] leading-snug text-label-secondary md:text-[21px]">
              On a parent&apos;s phone, open Settings, then Devices, and choose &ldquo;Pair a tablet&rdquo;. Type the
              code shown there.
            </p>
            <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
              <div>
                <label htmlFor="pairing-code" className={labelClass}>
                  Pairing code
                </label>
                <input
                  id="pairing-code"
                  name="pairing-code"
                  value={code}
                  onChange={(e) => {
                    setCode(formatCodeInput(e.target.value))
                    setError(null)
                  }}
                  placeholder="ABCD-2345"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="text"
                  maxLength={9}
                  aria-describedby="pairing-code-hint"
                  aria-invalid={error ? true : undefined}
                  className={`${inputClass} max-w-xs font-mono text-[28px] tracking-[0.12em] min-h-[60px]`}
                />
                <p id="pairing-code-hint" className="mt-2 text-[15px] text-label-secondary">
                  8 letters and numbers. Dashes and spaces are optional.
                </p>
              </div>
              {error && (
                <p role="alert" className={errorTextClass}>
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy} className={primaryButtonClass}>
                {busy && <Loader2 className="h-5 w-5 motion-safe:animate-spin" aria-hidden="true" />}
                Connect
              </button>
            </form>
          </>
        )}

        {waiting && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className={`mt-5 ${headingClass}`}>
              Type this number on the parent&apos;s phone
            </h1>
            <p
              data-testid="confirm-digits"
              aria-label={`Confirmation number ${waiting.digits.split('').join(' ')}`}
              className="mt-6 font-mono text-[72px] font-bold leading-none tracking-[0.25em] text-label-primary md:text-[96px]"
            >
              {waiting.digits}
            </p>
            <p role="status" className="mt-6 flex items-center gap-2 text-[19px] text-label-primary">
              <Loader2 className="h-5 w-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
              Waiting for a parent to confirm.
            </p>
            <p data-testid="pair-expiry" className="mt-2 text-[17px] text-label-secondary">
              This code expires in {formatCountdown(waiting.expiresAt - now)}.
            </p>
            <div className="mt-8">
              <button type="button" onClick={restart} className={neutralButtonClass}>
                Start again
              </button>
            </div>
          </>
        )}

        {state.kind === 'paired' && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className={`mt-5 ${headingClass}`}>
              Connected
            </h1>
            <p role="status" className="mt-3 text-[19px] text-label-secondary">
              {state.label} is ready. Opening today&apos;s board.
            </p>
          </>
        )}

        {(state.kind === 'expired' || state.kind === 'cancelled' || state.kind === 'device_limit') && (
          <>
            <h1 ref={headingRef} tabIndex={-1} className={`mt-5 ${headingClass}`}>
              {ENDED_COPY[state.kind].title}
            </h1>
            <p role="alert" className="mt-3 text-[19px] leading-snug text-label-secondary md:text-[21px]">
              {ENDED_COPY[state.kind].body}
            </p>
            <div className="mt-8">
              <button type="button" onClick={restart} className={primaryButtonClass}>
                Enter a new code
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
