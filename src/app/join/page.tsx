'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Users, ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'
import { useJoinFamilyText } from '@/i18n/join-family'
import { usePendingFormNavigationController } from '@/components/layout/pending-form-navigation'

export const dynamic = 'force-dynamic'

type EmailInvite = {
  familyName: string
  role: 'parent' | 'teen' | 'child'
  email: string
}

type JoinError = 'invalid' | 'auth' | 'retry' | 'network'
const errorKeys: Record<JoinError, string> = {
  invalid: 'join.invalidCode', auth: 'common.error', retry: 'common.tryAgain', network: 'common.networkError',
}
function refusalKey(status: number): JoinError {
  return status === 404 ? 'invalid' : status === 401 || status === 403 ? 'auth' : 'retry'
}

export default function JoinFamilyPage() {
  const { t } = useTranslation()
  const text = useJoinFamilyText()
  const [code, setCode] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [emailInvite, setEmailInvite] = useState<EmailInvite | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<JoinError | null>(null)
  const [success, setSuccess] = useState<{ kind: 'email' | 'code'; family: string | null } | null>(null)
  const [familyInfo, setFamilyInfo] = useState<{ name: string; code: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const lookupGeneration = useRef(0)
  const lookupRequest = useRef<AbortController | null>(null)
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pageGeneration = useRef(0)
  const [loggedIn, setLoggedIn] = useState(false)
  // A code lookup is intentionally session-gated. Keep that result separate
  // from an invalid code so a signed-out person can continue to auth without
  // making the family name lookup public.
  const [signedOutCode, setSignedOutCode] = useState(false)
  // Set once the page is leaving (joined, or sent to log in / register): the
  // join button stays disabled through the success pause until the redirect,
  // so a second tap cannot send a second join.
  const [leaving, setLeaving] = useState(false)
  const submittingRef = useRef(false)
  const busy = loading || leaving || !!success
  const router = useRouter()
  const { releaseBeforeNavigation } = usePendingFormNavigationController(busy)
  const navigateAfterRelease = useCallback(
    async (href: string, refresh = false) => {
      const own = pageGeneration.current
      if (!(await releaseBeforeNavigation()) || own !== pageGeneration.current) return
      router.push(href)
      if (refresh) router.refresh()
    },
    [releaseBeforeNavigation, router],
  )
  const checkFamilyCode = useCallback(async (familyCode: string) => {
    if (submittingRef.current) return
    const own = ++lookupGeneration.current
    lookupRequest.current?.abort()
    const controller = new AbortController()
    lookupRequest.current = controller
    setChecking(true)
    setFamilyInfo(null)
    setSignedOutCode(false)
    setError(null)
    try {
      const res = await fetch(`/api/family/lookup?code=${encodeURIComponent(familyCode)}`, { cache: 'no-store', signal: controller.signal })
      if (own !== lookupGeneration.current) return
      if (res.status === 401) {
        setSignedOutCode(true)
        return
      }
      const data = await res.json()
      if (own !== lookupGeneration.current) return
      if (!res.ok) { setError(refusalKey(res.status)); return }
      if (!data?.family || typeof data.family.name !== 'string') { setError('retry'); return }
      setFamilyInfo({ name: data.family.name, code: familyCode.trim() })
    } catch {
      if (own === lookupGeneration.current) setError('network')
    } finally {
      if (own === lookupGeneration.current) setChecking(false)
    }
  }, [])

  useEffect(() => {
    pageGeneration.current++
    let active = true
    const controller = new AbortController()
    const searchParams = new URLSearchParams(window.location.search)
    const urlToken = searchParams.get('token')
    const urlCode = searchParams.get('code')
    void fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal })
      .then(async res => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => { if (active) setLoggedIn(ok && Boolean(data.user)) })
      .catch(() => { if (active) setLoggedIn(false) })

    if (urlToken) {
      setToken(urlToken)
      void fetch(`/api/family/invites/preview?token=${encodeURIComponent(urlToken)}`, { cache: 'no-store', signal: controller.signal })
        .then(async res => {
          const data = await res.json()
          if (!active) return
          if (!res.ok) { setError(refusalKey(res.status)); return }
          if (typeof data?.familyName !== 'string' || typeof data.email !== 'string' ||
            !['parent', 'teen', 'child'].includes(data.role)) { setError('retry'); return }
          setEmailInvite(data)
        })
        .catch(() => { if (active) setError('network') })
    } else if (urlCode) {
      setCode(urlCode)
      void checkFamilyCode(urlCode)
    }
    return () => {
      active = false
      pageGeneration.current++
      controller.abort()
      lookupGeneration.current++
      lookupRequest.current?.abort()
      if (redirectTimer.current) clearTimeout(redirectTimer.current)
    }
  }, [checkFamilyCode])

  const acceptEmailInvite = async () => {
    if (!token || submittingRef.current) return
    submittingRef.current = true
    const own = pageGeneration.current
    setLoading(true)
    setError(null)
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (own !== pageGeneration.current) return
      if (!meRes.ok || !meData.user) {
        setLeaving(true)
        await navigateAfterRelease(`/register?token=${encodeURIComponent(token)}`)
        return
      }
      const joinRes = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const joinData = await joinRes.json()
      if (own !== pageGeneration.current) return
      if (!joinRes.ok) {
        submittingRef.current = false
        setError(refusalKey(joinRes.status))
        return
      }
      setSuccess({ kind: 'email', family: typeof joinData.familyName === 'string' ? joinData.familyName : emailInvite?.familyName || null })
      redirectTimer.current = setTimeout(() => {
        void navigateAfterRelease('/dashboard', true)
      }, 1500)
    } catch {
      if (own === pageGeneration.current) {
        submittingRef.current = false
        setError('network')
      }
    } finally {
      if (own === pageGeneration.current) setLoading(false)
    }
  }

  const handleJoinFamily = async (e: React.FormEvent) => {
    e.preventDefault()
    if (token) {
      await acceptEmailInvite()
      return
    }
    if (submittingRef.current) return
    submittingRef.current = true
    const own = pageGeneration.current
    setLoading(true)
    setError(null)
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (own !== pageGeneration.current) return
      if (!meRes.ok || !meData.user) {
        setLeaving(true)
        await navigateAfterRelease(
          `/login?redirect=${encodeURIComponent(`/join?code=${encodeURIComponent(code.trim())}`)}`,
        )
        return
      }
      if (!familyInfo || familyInfo.code !== code.trim()) {
        submittingRef.current = false
        setError('retry')
        return
      }
      const joinRes = await fetch('/api/family/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode: code.trim() }),
      })
      const joinData = await joinRes.json()
      if (own !== pageGeneration.current) return
      if (!joinRes.ok) {
        submittingRef.current = false
        setError(refusalKey(joinRes.status))
        return
      }
      setSuccess({ kind: 'code', family: typeof joinData.familyName === 'string' ? joinData.familyName : familyInfo.name })
      redirectTimer.current = setTimeout(() => {
        void navigateAfterRelease('/dashboard', true)
      }, 2000)
    } catch {
      if (own === pageGeneration.current) {
        submittingRef.current = false
        setError('network')
      }
    } finally {
      if (own === pageGeneration.current) setLoading(false)
    }
  }

  if (token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full space-y-6">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-accent-fill rounded-full flex items-center justify-center">
                <Users className="w-8 h-8 text-white" />
              </div>
            </div>
            <h1 className="text-3xl font-bold text-foreground">{text('invited')}</h1>
          </div>
          <div className="card space-y-4">
            {error && (
              <div role="alert" aria-live="assertive" className="bg-[var(--danger-tint)] border border-[var(--danger-tint)] text-danger-text px-4 py-3 rounded-md">{t(errorKeys[error])}</div>
            )}
            {success && (
              <div role="status" className="bg-[var(--success-tint)] border border-[var(--success-tint)] text-success-text px-4 py-3 rounded-md">
                <div className="flex items-center">
                  <Check className="w-5 h-5 mr-2" />
                  {text(success.kind === 'email' ? 'joinedEmail' : 'joinedCode', { family: success.family ?? text('fallbackFamily') })}
                </div>
              </div>
            )}
            {emailInvite && !success && (
              <>
                <p className="text-foreground">
                  {text('invite', { family: emailInvite.familyName, role: text(emailInvite.role) })}
                </p>
                <p className="text-sm text-muted-foreground">{text('sentTo', { email: emailInvite.email })}</p>
                {loggedIn ? (
                  <button
                    type="button"
                    onClick={acceptEmailInvite}
                    disabled={busy}
                    className="btn-primary w-full py-3 inline-flex items-center justify-center"
                  >
                    {text(busy ? 'joining' : 'joinEmail')}
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </button>
                ) : (
                  <div className="space-y-3">
                    <Link
                      href={`/register?token=${encodeURIComponent(token)}`}
                      className="btn-primary w-full py-3 inline-flex items-center justify-center"
                    >
                      {text('create')}
                    </Link>
                    <Link
                      href={`/login?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(`/join?token=${token}`)}`}
                      className="btn-secondary w-full py-3 inline-flex items-center justify-center"
                    >
                      {text('existing')}
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
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-accent-fill rounded-full flex items-center justify-center">
              <Users className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground">{text('title')}</h1>
          <p className="mt-2 text-muted-foreground">
            {text('description')}
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleJoinFamily} className="space-y-6">
            {error && (
              <div role="alert" aria-live="assertive" className="bg-[var(--danger-tint)] border border-[var(--danger-tint)] text-danger-text px-4 py-3 rounded-md">
                {t(errorKeys[error])}
              </div>
            )}
            {success && (
              <div role="status" className="bg-[var(--success-tint)] border border-[var(--success-tint)] text-success-text px-4 py-3 rounded-md">
                <div className="flex items-center">
                  <Check className="w-5 h-5 mr-2" />
                  {text(success.kind === 'email' ? 'joinedEmail' : 'joinedCode', { family: success.family ?? text('fallbackFamily') })}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-foreground mb-2">
                {text('code')}
              </label>
              <div className="flex space-x-4">
                <input
                  id="code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => {
                    if (submittingRef.current) return
                    lookupGeneration.current++
                    lookupRequest.current?.abort()
                    setChecking(false)
                    setError(null)
                    setCode(e.target.value)
                    setFamilyInfo(null)
                    setSignedOutCode(false)
                  }}
                  className="input-field flex-1 font-mono tabular-nums tracking-wider"
                  placeholder={text('codeExample')}
                  aria-describedby="code-hint"
                  inputMode="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={64}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => checkFamilyCode(code)}
                  disabled={busy || checking || !code.trim()}
                  className="btn-secondary min-h-[44px] whitespace-nowrap"
                >
                  {text(checking ? 'checking' : 'check')}
                </button>
              </div>
              <p id="code-hint" className="mt-2 text-sm text-muted-foreground">
                {text('hint')}
              </p>
            </div>
            {familyInfo && familyInfo.code === code.trim() && (
              <div className="bg-[var(--accent-tint)] border border-[var(--accent-tint-strong)] rounded-lg p-4">
                <div className="font-medium text-foreground">{familyInfo.name}</div>
                <div className="text-sm text-primary">{text('ready')}</div>
              </div>
            )}
            {signedOutCode && (
              <div className="bg-[var(--accent-tint)] border border-[var(--accent-tint-strong)] rounded-lg p-4 space-y-3" role="status">
                <p className="text-sm text-primary">{t('join.signInToContinue')}</p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Link
                    href={`/login?redirect=${encodeURIComponent(`/join?code=${encodeURIComponent(code.trim())}`)}`}
                    className="btn-tinted flex-1 justify-center"
                  >
                    {t('join.signInToJoin')}
                  </Link>
                </div>
              </div>
            )}
            {!signedOutCode && (
              <button
                type="submit"
                disabled={busy || checking || !code.trim() || !familyInfo || familyInfo.code !== code.trim()}
                className="btn-primary w-full py-3 inline-flex items-center justify-center"
              >
                {text(busy ? 'joining' : 'joinCode')}
                <ArrowRight className="w-5 h-5 ml-2" />
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
