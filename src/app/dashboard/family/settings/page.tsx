'use client'

import { useState, useEffect } from 'react'
import { Users, AlertTriangle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { cn } from '@/lib/utils'
import BoardSettings from '@/components/fridge/BoardSettings'
import DeleteAccountDialog from '@/components/account/DeleteAccountDialog'

export default function FamilySettingsPage() {
  const [familyName, setFamilyName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [userRole, setUserRole] = useState('')
  const [familyId, setFamilyId] = useState('')

  useEffect(() => {
    loadFamilyData()
  }, [])

  const loadFamilyData = async () => {
    setLoading(true)
    try {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meRes.ok || !meData.user) return

      const user = meData.user
      setUserRole(user.role || '')
      setFamilyId(user.family_id || '')

      if (!user.family_id) return

      if (user.family) {
        setFamilyName(user.family.name || '')
      }
    } catch (err) {
      console.error('Error loading family data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      if (!familyId) {
        setError('No family found')
        return
      }

      const res = await fetch('/api/family', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId, name: familyName }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to update settings')
        return
      }

      setSuccess('Family name saved.')
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="pb-20">
        <LargeHeader title="Settings" className="px-4" />
        <div className="px-4 flex items-center justify-center py-20">
          <div className="text-subhead text-label-secondary">Loading…</div>
        </div>
      </div>
    )
  }

  if (!familyId) {
    return (
      <div className="pb-20">
        <LargeHeader title="Settings" className="px-4" />
        <div className="px-4">
          <div className="card-apple p-8 text-center">
            <Users className="w-12 h-12 text-label-tertiary mx-auto mb-4" />
            <h2 className="text-title-3 text-label-primary mb-2">No Family Found</h2>
            <p className="text-subhead text-label-secondary mb-6">
              You don&apos;t belong to a family yet.
            </p>
            <div className="flex gap-3 justify-center">
              <Link href="/dashboard/family/create" className="btn-primary">Create Family</Link>
              <Link href="/join" className="btn-secondary">Join Family</Link>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-20">
      <LargeHeader
        title="Settings"
        trailing={
          <Glyph color="family" size="md">
            <Users className="w-4 h-4" />
          </Glyph>
        }
        className="px-4"
      />

      <div className="px-4 space-y-4">
        {/* Settings form */}
        <form onSubmit={handleSaveSettings}>
          <div className="card-apple overflow-hidden">
            {error && (
              <div role="alert" className="mx-4 mt-4 bg-[var(--danger-tint)] border border-[var(--danger-tint)] text-danger-text px-4 py-3 rounded-xl text-subhead">
                {error}
              </div>
            )}
            {success && (
              <div role="status" className="mx-4 mt-4 bg-[var(--success-tint)] border border-[var(--success-tint)] text-success-text px-4 py-3 rounded-xl text-subhead">
                {success}
              </div>
            )}

            <div className="p-4 space-y-4">
              <div>
                <label htmlFor="familyName" className="block text-subhead font-medium text-label-primary mb-2">
                  Family Name
                </label>
                <input
                  id="familyName"
                  type="text"
                  required
                  value={familyName}
                  onChange={(e) => setFamilyName(e.target.value)}
                  className="input-apple w-full"
                  placeholder="The Smith Family"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[var(--surface-separator)]">
              <button
                type="submit"
                disabled={saving || !familyName.trim()}
                className="btn-primary w-full"
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </form>

        {/* Today board: member colours and opt-in weather (#262). Parents only; the API enforces it too. */}
        {userRole === 'parent' && <BoardSettings />}

        {/* Danger zone */}
        <div className="card-apple overflow-hidden border border-[var(--danger-tint)]">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-danger-text" />
              <h2 className="text-title-3 text-label-primary font-semibold">Danger Zone</h2>
            </div>

            {/* Account and household deletion (docs/product/ACCOUNT_DELETION.md).
                One dialog decides what this member may delete: their own
                account, or, for the only parent, the whole household. It asks
                for the password and a typed confirmation in the page. */}
            <div className="flex items-center justify-between gap-3 p-3 bg-[var(--danger-tint)] border border-[var(--danger-tint)] rounded-xl">
              <div>
                <p className="text-subhead font-medium text-label-primary">Delete account or household</p>
                <p className="text-caption-1 text-label-secondary mt-0.5">
                  Permanently delete your account. The only parent can delete the whole household.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteDialog(true)}
                className="btn-secondary shrink-0 min-h-[44px] border-[var(--danger)] text-danger-text hover:bg-[var(--danger-tint)]"
              >
                <Trash2 className="w-4 h-4" aria-hidden="true" />
                <span>Delete…</span>
              </button>
            </div>
          </div>
        </div>
        <DeleteAccountDialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} />
      </div>
    </div>
  )
}