'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LogIn, Eye, EyeOff, Users } from 'lucide-react'
import { useTranslation } from '@/i18n'

export default function LoginPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendState, setResendState] = useState<'idle' | 'sending' | 'sent'>('idle')
  const [registerHref, setRegisterHref] = useState('/register')
  const router = useRouter()

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token')
    if (token) setRegisterHref(`/register?token=${encodeURIComponent(token)}`)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('auth.loginFailed'))
        return
      }

      const params = new URLSearchParams(window.location.search)
      const redirect = params.get('redirect')
      const token = params.get('token')
      if (redirect && redirect.startsWith('/')) {
        router.push(redirect)
      } else if (token) {
        router.push(`/join?token=${encodeURIComponent(token)}`)
      } else {
        router.push('/dashboard')
      }
      router.refresh()
    } catch {
      setError(t('auth.unexpectedError'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResendState('sending')
    try {
      // Always answers 200 whether or not the account exists; nothing to
      // surface beyond the confirmation state.
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    } catch {
      // Transport error — the endpoint's own retries/rate limits apply.
    }
    setResendState('sent')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-grouped)] px-4">
      <div className="w-full max-w-sm">
        {/* Logo glyph */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-[var(--accent-fill)] rounded-[var(--radius-xl)] flex items-center justify-center shadow-[var(--shadow-md)]">
            <Users className="w-8 h-8 text-white" />
          </div>
        </div>

        <div className="card-apple p-6">
          <div className="text-center mb-6">
            <h1 className="text-title-2">{t('auth.welcomeBack')}</h1>
            <p className="text-[15px] text-[var(--label-secondary)] mt-1">
              {t('auth.signInSubtitle')}
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {error && (
              <div
                role="alert"
                aria-live="assertive"
                className="bg-[var(--danger-tint)] text-[var(--danger-text)] text-[15px] rounded-[var(--radius-md)] px-4 py-3"
              >
                {error}
              </div>
            )}

            {error && /verify/i.test(error) && (
              <button
                type="button"
                className="btn-plain w-full py-3"
                onClick={handleResend}
                disabled={resendState !== 'idle' || loading}
              >
                {resendState === 'sent'
                  ? 'Verification email sent again'
                  : resendState === 'sending'
                    ? 'Sending…'
                    : 'Resend verification email'}
              </button>
            )}

            <div>
              <label htmlFor="email" className="label-apple">{t('auth.email')}</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-apple"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="label-apple">{t('auth.password')}</label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-apple pr-10"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-[var(--label-tertiary)] hover:text-[var(--label-primary)] transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={loading}
                className="btn-filled w-full py-3"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                    {t('auth.signingIn')}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <LogIn className="w-4 h-4" />
                    {t('auth.signIn')}
                  </span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-4 text-center">
            <p className="text-[15px] text-[var(--label-secondary)]">
              {t('auth.noAccount')}{' '}
              <Link href={registerHref} className="btn-plain py-1 px-2 -my-1">
                {t('auth.signUp')}
              </Link>
            </p>
          </div>
        </div>

        <p className="text-center text-[13px] text-[var(--label-tertiary)] mt-6">
          {t('auth.bySigningIn')}
        </p>
      </div>
    </div>
  )
}