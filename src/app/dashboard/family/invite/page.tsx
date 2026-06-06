'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, UserPlus } from 'lucide-react'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { cn } from '@/lib/utils'

export default function InviteMemberPage() {
  const [familyCode, setFamilyCode] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadFamilyData()
  }, [])

  const loadFamilyData = async () => {
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || !meData.user) return

      const user = meData.user
      if (!user.family_id) return

      const code = `FAM-${user.family_id.slice(0, 8).toUpperCase()}`
      setFamilyCode(code)
      setInviteLink(`${window.location.origin}/join?code=${code}`)
    } catch (err) {
      console.error('Error loading family data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(familyCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="pb-20">
      <LargeHeader
        title="Invite"
        subtitle="Share with family members"
        trailing={
          <Glyph color="family" size="md">
            <UserPlus className="w-4 h-4" />
          </Glyph>
        }
        className="px-4"
      />

      <div className="px-4 space-y-4">
        {/* Share code — large monospace */}
        <div className="card-apple p-5 text-center">
          <p className="text-subhead text-label-secondary mb-3">Family Code</p>
          <p className="text-large-title font-mono font-bold text-label-primary tracking-wider">
            {loading ? 'Loading…' : familyCode}
          </p>
          <button
            onClick={handleCopyCode}
            className="btn-tinted mt-4"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Copied!' : 'Copy Code'}</span>
          </button>
        </div>

        {/* Invite link */}
        <div className="card-apple p-5">
          <p className="text-subhead text-label-secondary mb-3">Invite Link</p>
          <div className="flex items-center gap-2">
            <div className="flex-1 input-apple text-footnote truncate font-mono text-label-secondary">
              {loading ? 'Loading…' : inviteLink}
            </div>
            <button
              onClick={handleCopyLink}
              className="btn-secondary shrink-0"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>Copy</span>
            </button>
          </div>
        </div>

        {/* Info card */}
        <div className="card-apple p-4">
          <p className="text-footnote text-label-secondary">
            Share this code or link with family members. They can use it to join your family on the join page.
          </p>
        </div>
      </div>
    </div>
  )
}