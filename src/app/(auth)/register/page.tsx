'use client'

import { useState } from 'react'
import Link from 'next/link'
import { UserPlus, CheckCircle, Users } from 'lucide-react'
import { useTranslation } from '@/i18n'

export default function RegisterPage() {
  const { t } = useTranslation()
  const [showVerificationNotice, setShowVerificationNotice] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'))
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError(t('auth.passwordTooShort'))
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('auth.registrationFailed'))
        return
      }

      setError(null)
      setShowVerificationNotice(true)
    } catch (err) {
      setError(t('auth.unexpectedError'))
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (showVerificationNotice) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--surface-grouped)] px-4">
        <div className="w-full max-w-sm text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[var(--success)] rounded-[var(--radius-xl)] flex items-center justify-center shadow-[var(--shadow-md)]">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
          </div>
          <div className="card-apple p-6">
            <h1 className="text-title-2 mb-2">Check Your Email</h1>
            <p className="text-[15px] text-[var(--label-secondary)] mb-6">
              We sent a verification link to your email address. Click the link to activate your account, then sign in.
            </p>
            <Link href="/login" className="btn-filled w-full py-3">
              Go to Sign In
            </Link>
          </div>
        </div>
      </div>
    )
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
            <h1 className="text-title-2">{t('auth.createAccount')}</h1>
            <p className="text-[15px] text-[var(--label-secondary)] mt-1">
              {t('auth.createAccountSubtitle')}
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            {error && (
              <div className="bg-[var(--danger-tint)] text-[var(--danger)] text-[15px] rounded-[var(--radius-md)] px-4 py-3">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="name" className="label-apple">{t('auth.fullName')}</label>
              <input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-apple"
                placeholder="John Doe"
              />
            </div>

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
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-apple"
                placeholder="••••••••"
              />
              <p className="text-[11px] text-[var(--label-tertiary)] mt-1 px-1">
                {t('auth.passwordHint')}
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="label-apple">{t('auth.confirmPassword')}</label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-apple"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-start gap-2.5 pt-1">
              <input
                id="terms"
                type="checkbox"
                required
                className="mt-0.5 h-4 w-4 rounded border-[var(--surface-separator)] bg-[var(--surface-fill)] accent-[var(--accent)]"
              />
              <label htmlFor="terms" className="text-[13px] text-[var(--label-secondary)] leading-4">
                {t('auth.agreeToTerms')}{' '}
                <Link href="/terms" className="text-[var(--accent)] hover:underline">
                  {t('auth.termsOfService')}
                </Link>{' '}
                {t('auth.and')}{' '}
                <Link href="/privacy" className="text-[var(--accent)] hover:underline">
                  {t('auth.privacyPolicy')}
                </Link>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-filled w-full py-3"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  {t('auth.creatingAccount')}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  {t('auth.createAccountBtn')}
                </span>
              )}
            </button>
          </form>

          <div className="mt-4 text-center">
            <p className="text-[15px] text-[var(--label-secondary)]">
              {t('auth.alreadyHaveAccount')}{' '}
              <Link href="/login" className="btn-plain py-1 px-2 -my-1">
                {t('auth.signInLink')}
              </Link>
            </p>
          </div>
        </div>

        <div className="text-center mt-6">
          <p className="text-[13px] text-[var(--label-tertiary)]">
            {t('auth.bySigningUp')}
          </p>
          <p className="mt-1 text-[12px] text-[var(--label-quaternary)]">
            {t('auth.freeTrial')} &middot; {t('auth.noCreditCard')}
          </p>
        </div>
      </div>
    </div>
  )
}