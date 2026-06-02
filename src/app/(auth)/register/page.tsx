'use client'

import { useState } from 'react'
import Link from 'next/link'
import { UserPlus, CheckCircle } from 'lucide-react'
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

      // Show verification notice instead of redirecting immediately
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Check Your Email</h1>
            <p className="mt-4 text-gray-600">
              We sent a verification link to your email address. Click the link to activate your account, then sign in.
            </p>
            <div className="mt-8">
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-blue-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-blue-700 transition-colors"
              >
                Go to Sign In
              </Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
              <UserPlus className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">{t('auth.createAccount')}</h1>
          <p className="mt-2 text-gray-600">
            {t('auth.createAccountSubtitle')}
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleRegister} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.fullName')}
              </label>
              <input
                id="name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
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

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.password')}
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
              />
              <p className="mt-1 text-xs text-gray-500">
                {t('auth.passwordHint')}
              </p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                {t('auth.confirmPassword')}
              </label>
              <input
                id="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="input-field"
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center">
              <input
                id="terms"
                type="checkbox"
                required
                className="h-4 w-4 text-blue-600 border-gray-300 rounded"
              />
              <label htmlFor="terms" className="ml-2 block text-sm text-gray-700">
                {t('auth.agreeToTerms')}{' '}
                <Link href="/terms" className="text-blue-600 hover:text-blue-500">
                  {t('auth.termsOfService')}
                </Link>{' '}
                {t('auth.and')}{' '}
                <Link href="/privacy" className="text-blue-600 hover:text-blue-500">
                  {t('auth.privacyPolicy')}
                </Link>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3"
            >
              {loading ? t('auth.creatingAccount') : t('auth.createAccountBtn')}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              {t('auth.alreadyHaveAccount')}{' '}
              <Link href="/login" className="text-blue-600 hover:text-blue-500 font-medium">
                {t('auth.signInLink')}
              </Link>
            </p>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm text-gray-500">
            {t('auth.bySigningUp')}
          </p>
          <p className="mt-2 text-xs text-gray-400">
            {t('auth.freeTrial')} - {t('auth.noCreditCard')}
          </p>
        </div>
      </div>
    </div>
  )
}
