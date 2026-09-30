'use client'

// Email confirm step (O-24). The emailed link opens this page; opening it does
// nothing to the token, so a mail scanner that fetches the link cannot use it
// up. Only the "Confirm my email" button POSTs /api/auth/verify-email.
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { MailCheck } from 'lucide-react'
import { confirmEmailToken, VERIFIED_REDIRECT, VERIFY_MESSAGES, type VerifyOutcome } from '@/lib/verify-email'

type State = 'idle' | 'submitting' | Exclude<VerifyOutcome, 'verified'>

function VerifyEmailConfirm() {
  const router = useRouter()
  const token = useSearchParams().get('token')
  const [state, setState] = useState<State>('idle')

  const confirm = async () => {
    if (!token) return
    setState('submitting')
    const outcome = await confirmEmailToken(token)
    if (outcome === 'verified') {
      router.replace(VERIFIED_REDIRECT)
      return
    }
    setState(outcome)
  }

  const canRetry = state === 'idle' || state === 'submitting' || state === 'error' || state === 'rate_limited'
  const notice =
    state === 'idle' || state === 'submitting'
      ? null
      : { kind: state === 'already_verified' ? ('success' as const) : ('error' as const), text: VERIFY_MESSAGES[state] }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-grouped)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-[var(--accent-fill)] rounded-[var(--radius-xl)] flex items-center justify-center shadow-[var(--shadow-md)]">
            <MailCheck className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
        </div>

        <div className="card-apple p-6">
          <div className="text-center mb-6">
            <h1 className="text-title-2">Confirm your email</h1>
            <p className="text-[15px] text-[var(--label-secondary)] mt-1">
              {token
                ? 'Press the button to finish setting up your Family Planner account.'
                : 'That verification link is incomplete. Copy the whole link from the email, or sign in to get a new one.'}
            </p>
          </div>

          {notice && (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={
                notice.kind === 'error'
                  ? 'mb-4 rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]'
                  : 'mb-4 rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-4 py-3 text-[15px] text-[var(--label-primary)]'
              }
            >
              {notice.text}
            </p>
          )}

          {token && canRetry && (
            <button
              type="button"
              onClick={confirm}
              disabled={state === 'submitting'}
              className="btn-filled w-full py-3"
            >
              {state === 'submitting' ? 'Confirming…' : 'Confirm my email'}
            </button>
          )}

          <Link href="/login" className="btn-plain w-full py-3 mt-3 flex justify-center">
            Go to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--surface-grouped)]">
          <div className="text-[var(--label-secondary)]">Loading...</div>
        </div>
      }
    >
      <VerifyEmailConfirm />
    </Suspense>
  )
}
