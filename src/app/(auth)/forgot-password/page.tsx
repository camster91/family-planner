'use client'

import { useState } from 'react'
import Link from 'next/link'
import { KeyRound } from 'lucide-react'
import { useTranslation } from '@/i18n'

export default function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t('common.error'))
        return
      }
      setSuccess(true)
    } catch {
      setError(t('auth.unexpectedError'))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--surface-grouped)] px-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-[var(--success-tint)] rounded-[var(--radius-xl)] flex items-center justify-center">
                <KeyRound className="w-8 h-8 text-success-text" />
              </div>
            </div>
            <h1 className="text-title-2 text-label-primary">Check Your Email</h1>
            <p className="mt-2 text-[var(--label-secondary)]">
              If an account exists with <span className="font-medium">{email}</span>, you&apos;ll receive a password reset link.
            </p>
          </div>
          <div className="text-center">
            <Link href="/login" className="text-[var(--accent-text)] hover:underline font-medium">
              {t('auth.backToSignIn')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--surface-grouped)] px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-[var(--accent-fill)] rounded-[var(--radius-xl)] shadow-[var(--shadow-md)] flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-title-2 text-label-primary">{t('auth.forgotPasswordTitle')}</h1>
          <p className="mt-2 text-[var(--label-secondary)]">
            {t('auth.forgotPasswordSubtitle')}
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="bg-[var(--danger-tint)] text-[var(--danger-text)] px-4 py-3 rounded-[var(--radius-md)]">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[var(--label-primary)] mb-2">
                {t('auth.email')}
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? t('auth.sendingResetLink') : t('auth.sendResetLink')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-[var(--label-secondary)]">
              {t('auth.alreadyHaveAccount')}{' '}
              <Link href="/login" className="inline-flex items-center py-2 text-[var(--accent-text)] hover:underline font-medium min-h-11">
                {t('auth.signInLink')}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}