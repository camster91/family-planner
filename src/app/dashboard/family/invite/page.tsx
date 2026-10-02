'use client'

import { useState, useEffect, useCallback } from 'react'
import { Copy, Check, UserPlus, Mail, X, RefreshCw } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { Dialog } from '@/components/ui/dialog'
import { FAMILY_CODE_LENGTH, formatFamilyCode } from '@/lib/family-code'

type PendingInvite = {
  id: string
  email: string
  role: string
  expires_at: string
}

/**
 * A new 12-character code is copied as shown (`K7QM-4XPD-2HNA`); an older
 * 24/25-character code is copied exactly as stored, so a paste works anywhere.
 * The join form accepts either (src/lib/family-code.ts).
 */
function codeToCopy(code: string): string {
  return code.length === FAMILY_CODE_LENGTH ? formatFamilyCode(code) : code
}

export default function InviteMemberPage() {
  const [familyCode, setFamilyCode] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState<'code' | 'link' | null>(null)
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'child' | 'teen' | 'parent'>('child')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [invites, setInvites] = useState<PendingInvite[]>([])
  // "Get a new family code" (O-34): confirm step, then POST /api/family/invite-code.
  const [confirmNewCode, setConfirmNewCode] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeMessage, setCodeMessage] = useState<string | null>(null)

  const showCode = useCallback((code: string) => {
    setFamilyCode(code)
    setInviteLink(`${window.location.origin}/join?code=${encodeURIComponent(code)}`)
  }, [])

  const load = useCallback(async () => {
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || meData.user?.role !== 'parent') return

      const [familyRes, inviteRes] = await Promise.all([
        fetch('/api/family'),
        fetch('/api/family/invites'),
      ])
      const familyData = await familyRes.json()
      const inviteData = await inviteRes.json()
      const inviteCode = familyData.family?.invite_code
      if (familyRes.ok && inviteCode) showCode(inviteCode)
      if (inviteRes.ok) setInvites(inviteData.invites || [])
    } catch (err) {
      console.error('Error loading invite page:', err)
    } finally {
      setLoading(false)
    }
  }, [showCode])

  useEffect(() => {
    void load()
  }, [load])

  const handleNewCode = async () => {
    setRotating(true)
    setCodeError(null)
    try {
      const res = await fetch('/api/family/invite-code', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || typeof data.inviteCode !== 'string') {
        setCodeError(
          typeof data.error === 'string' ? data.error : 'Could not make a new code. Please try again.'
        )
        return
      }
      showCode(data.inviteCode)
      setConfirmNewCode(false)
      setCodeMessage('New code ready. The old code no longer works.')
    } catch {
      setCodeError('Could not make a new code. Check your connection and try again.')
    } finally {
      setRotating(false)
    }
  }

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setError(null)
    setMessage(null)
    try {
      const res = await fetch('/api/family/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not send invite')
        return
      }
      setEmail('')
      setMessage(`Invite sent to ${data.invite.email}`)
      await load()
    } catch {
      setError('Could not send invite')
    } finally {
      setSending(false)
    }
  }

  const handleRevoke = async (id: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/family/invites/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setInvites((current) => current.filter((invite) => invite.id !== id))
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Could not cancel that invite. Please try again.')
    } catch {
      setError('Could not cancel that invite. Check your connection and try again.')
    }
  }

  const copy = async (kind: 'code' | 'link', value: string) => {
    try {
      // Missing or refused on plain http and in some Android WebViews.
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      setError('Could not copy. Select the text and copy it yourself.')
    }
  }

  return (
    <div className="pb-20">
      <LargeHeader
        title="Invite"
        subtitle="Email a family member"
        trailing={
          <Glyph color="family" size="md">
            <UserPlus className="w-4 h-4" />
          </Glyph>
        }
        className="px-4"
      />

      <div className="px-4 space-y-4">
        <form onSubmit={handleSend} className="card-apple p-5 space-y-4">
          <p className="text-subhead text-label-secondary">
            They get a one-time link. You choose whether they join as a parent, teen, or child.
          </p>
          {error && (
            <div className="bg-[var(--danger-tint)] text-[var(--danger-text)] text-[15px] rounded-[var(--radius-md)] px-4 py-3">
              {error}
            </div>
          )}
          {message && (
            <div className="bg-[var(--success-tint,rgba(52,199,89,0.12))] text-[var(--success)] text-[15px] rounded-[var(--radius-md)] px-4 py-3">
              {message}
            </div>
          )}
          <div>
            <label htmlFor="invite-email" className="label-apple">Email</label>
            <input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-apple"
              placeholder="alex@example.com"
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="invite-role" className="label-apple">Role</label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="input-apple"
            >
              <option value="child">Child</option>
              <option value="teen">Teen</option>
              <option value="parent">Parent</option>
            </select>
          </div>
          <button type="submit" disabled={sending || !email.trim()} className="btn-filled w-full py-3">
            <Mail className="w-4 h-4" />
            {sending ? 'Sending…' : 'Send invite'}
          </button>
        </form>

        {invites.length > 0 && (
          <div className="card-apple p-5">
            <p className="text-subhead text-label-secondary mb-3">Pending</p>
            <ul className="space-y-3">
              {invites.map((invite) => (
                <li key={invite.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium truncate">{invite.email}</p>
                    <p className="text-footnote text-label-secondary">
                      {invite.role} · expires {new Date(invite.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevoke(invite.id)}
                    className="btn-plain min-h-[44px] min-w-[44px] shrink-0"
                    aria-label={`Revoke invite for ${invite.email}`}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="card-apple p-5">
          <summary className="text-[15px] font-medium cursor-pointer">In person instead</summary>
          <p className="text-footnote text-label-secondary mt-3 mb-4">
            For another phone in the room. This code does not choose a role — they join as a child or teen.
          </p>
          <p className="text-title-3 font-mono tabular-nums tracking-wider break-words">
            {loading ? 'Loading…' : familyCode ? formatFamilyCode(familyCode) : 'No code'}
          </p>
          <button
            type="button"
            onClick={() => familyCode && copy('code', codeToCopy(familyCode))}
            className="btn-tinted mt-3"
            disabled={!familyCode}
          >
            {copied === 'code' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied === 'code' ? 'Copied' : 'Copy code'}</span>
          </button>
          <div className="flex items-center gap-2 mt-4">
            <div className="flex-1 input-apple text-footnote truncate font-mono text-label-secondary">
              {loading ? 'Loading…' : inviteLink}
            </div>
            <button
              type="button"
              onClick={() => inviteLink && copy('link', inviteLink)}
              className="btn-secondary shrink-0"
              disabled={!inviteLink}
            >
              {copied === 'link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>Copy</span>
            </button>
          </div>
          {codeMessage && (
            <p role="status" className="mt-4 text-[15px] font-medium text-label-primary">
              {codeMessage}
            </p>
          )}
          <div className="mt-4 border-t border-[var(--surface-separator)] pt-4">
            <p className="text-footnote text-label-secondary mb-3">
              Shared the code with the wrong person, or posted it somewhere? Get a new one. The old code stops
              working right away. People who already joined stay — remove them on the Family page.
            </p>
            <button
              type="button"
              onClick={() => {
                setCodeError(null)
                setCodeMessage(null)
                setConfirmNewCode(true)
              }}
              className="btn-ghost min-h-[44px]"
              disabled={!familyCode}
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>Get a new family code</span>
            </button>
          </div>
        </details>

        <Dialog
          open={confirmNewCode}
          onClose={rotating ? undefined : () => setConfirmNewCode(false)}
          title="Get a new family code?"
          description="The current code stops working right away. Anyone you still want to join will need the new code."
        >
          {codeError && (
            <p
              role="alert"
              className="mb-4 rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[15px] text-[var(--danger-text)]"
            >
              {codeError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setConfirmNewCode(false)}
              disabled={rotating}
              className="btn-ghost min-h-[44px] flex-1"
            >
              Keep the current code
            </button>
            <button
              type="button"
              onClick={handleNewCode}
              disabled={rotating}
              className="btn-filled min-h-[44px] flex-1"
            >
              {rotating ? 'Making a new code…' : 'Get a new code'}
            </button>
          </div>
        </Dialog>
      </div>
    </div>
  )
}
