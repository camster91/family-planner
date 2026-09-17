'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Users, ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

type EmailInvite = {
  familyName: string
  role: string
  email: string
}

export default function JoinFamilyPage() {
  const [code, setCode] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [emailInvite, setEmailInvite] = useState<EmailInvite | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [familyInfo, setFamilyInfo] = useState<{ name: string } | null>(null)
  const [loggedIn, setLoggedIn] = useState(false)
  const router = useRouter()

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const urlToken = searchParams.get('token')
    const urlCode = searchParams.get('code')
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data) => setLoggedIn(Boolean(data.user)))
      .catch(() => setLoggedIn(false))

    if (urlToken) {
      setToken(urlToken)
      fetch(`/api/family/invites/preview?token=${encodeURIComponent(urlToken)}`)
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) {
            setError(data.error || 'This invite is invalid or expired')
            return
          }
          setEmailInvite(data)
        })
        .catch(() => setError('Could not load invite'))
      return
    }

    if (urlCode) {
      setCode(urlCode)
      checkFamilyCode(urlCode)
    }
  }, [])

  const checkFamilyCode = async (familyCode: string) => {
    try {
      const res = await fetch(`/api/family/lookup?code=${encodeURIComponent(familyCode)}`)
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Family not found. Please check the code.')
        return
      }
      setFamilyInfo(data.family)
      setError(null)
    } catch {
      setError('Failed to validate family code')
    }
  }

  const acceptEmailInvite = async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || !meData.user) {
        router.push(`/register?token=${encodeURIComponent(token)}`)
        return
      }
      const joinRes = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const joinData = await joinRes.json()
      if (!joinRes.ok) {
        setError(joinData.error || 'Failed to join family')
        return
      }
      setSuccess(`Joined ${joinData.familyName || emailInvite?.familyName || 'your family'}`)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1500)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinFamily = async (e: React.FormEvent) => {
    e.preventDefault()
    if (token) {
      await acceptEmailInvite()
      return
    }
    setLoading(true)
    setError(null)
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || !meData.user) {
        router.push(`/login?redirect=${encodeURIComponent(`/join?code=${code}`)}`)
        return
      }
      if (!familyInfo) {
        setError('Please check the family code first')
        return
      }
      const joinRes = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code.trim() }),
      })
      const joinData = await joinRes.json()
      if (!joinRes.ok) {
        setError(joinData.error || 'Failed to join family')
        return
      }
      setSuccess(`Successfully joined ${joinData.familyName || familyInfo.name}!`)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 2000)
    } catch {
      setError('An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  if (token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
                <Users className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">You are invited</h1>
          </div>
          <div className="card space-y-4">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">{error}</div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
                <div className="flex items-center">
                  <Check className="w-5 h-5 mr-2" />
                  {success}
                </div>
              </div>
            )}
            {emailInvite && !success && (
              <>
                <p className="text-gray-700">
                  Join <strong>{emailInvite.familyName}</strong> as a <strong>{emailInvite.role}</strong>.
                </p>
                <p className="text-sm text-gray-600">Sent to {emailInvite.email}</p>
                {loggedIn ? (
                  <button
                    type="button"
                    onClick={acceptEmailInvite}
                    disabled={loading}
                    className="btn-primary w-full py-3 inline-flex items-center justify-center"
                  >
                    {loading ? 'Joining...' : 'Join family'}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </button>
                ) : (
                  <div className="space-y-3">
                    <Link
                      href={`/register?token=${encodeURIComponent(token)}`}
                      className="btn-primary w-full py-3 inline-flex items-center justify-center"
                    >
                      Create account and join
                    </Link>
                    <Link
                      href={`/login?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(`/join?token=${token}`)}`}
                      className="btn-secondary w-full py-3 inline-flex items-center justify-center"
                    >
                      I already have an account
                    </Link>
                  </div>
                )}
              </>
            )}
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
              <Users className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Join a Family</h1>
          <p className="mt-2 text-gray-600">
            Use the in-person code from a parent, or open the link from your invite email.
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleJoinFamily} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
                <div className="flex items-center">
                  <Check className="w-5 h-5 mr-2" />
                  {success}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                Family Code
              </label>
              <div className="flex space-x-4">
                <input
                  id="code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value)
                    setFamilyInfo(null)
                  }}
                  className="input-field flex-1 font-mono"
                  placeholder="Invite code from a parent"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => checkFamilyCode(code)}
                  disabled={loading || !code.trim()}
                  className="btn-secondary whitespace-nowrap"
                >
                  Check Code
                </button>
              </div>
            </div>
            {familyInfo && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="font-medium text-blue-900">{familyInfo.name}</div>
                <div className="text-sm text-blue-700">Ready to join as a child or teen.</div>
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !code.trim() || !familyInfo}
              className="btn-primary w-full py-3 inline-flex items-center justify-center"
            >
              {loading ? 'Joining...' : 'Join Family'}
              <ArrowRight className="w-5 h-5 ml-2" />
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
