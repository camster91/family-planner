'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Users, AlertTriangle, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'
import { cn } from '@/lib/utils'

export default function FamilySettingsPage() {
  const [familyName, setFamilyName] = useState('')
  const [timezone, setTimezone] = useState('America/New_York')
  const [currency, setCurrency] = useState('USD')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [userRole, setUserRole] = useState('')
  const [familyId, setFamilyId] = useState('')
  const router = useRouter()

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

      setSuccess('Family settings updated successfully!')
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteFamily = async () => {
    if (!confirm('Are you absolutely sure? This will delete the entire family and all associated data. This action cannot be undone.')) {
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/family', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId }),
      })
      if (!res.ok) throw new Error('Failed to delete family')
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setSaving(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleLeaveFamily = async () => {
    if (!confirm('Are you sure you want to leave this family? You will lose access to all family data.')) {
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family_id: null }),
      })
      if (!res.ok) throw new Error('Failed to leave family')
      router.push('/dashboard')
      router.refresh()
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
              <div className="mx-4 mt-4 bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-xl text-subhead">
                {error}
              </div>
            )}
            {success && (
              <div className="mx-4 mt-4 bg-green-500/10 border border-green-500/20 text-green-500 px-4 py-3 rounded-xl text-subhead">
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

              <div>
                <label htmlFor="timezone" className="block text-subhead font-medium text-label-primary mb-2">
                  Timezone
                </label>
                <select
                  id="timezone"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="input-apple w-full"
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="Europe/London">London</option>
                  <option value="Europe/Paris">Paris</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                </select>
              </div>

              <div>
                <label htmlFor="currency" className="block text-subhead font-medium text-label-primary mb-2">
                  Currency
                </label>
                <select
                  id="currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="input-apple w-full"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="JPY">JPY (¥)</option>
                  <option value="CAD">CAD ($)</option>
                  <option value="AUD">AUD ($)</option>
                </select>
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

        {/* Danger zone */}
        <div className="card-apple overflow-hidden border border-red-500/20">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              <h2 className="text-title-3 text-label-primary font-semibold">Danger Zone</h2>
            </div>

            <div className="space-y-3">
              {/* Leave family */}
              <div className="flex items-center justify-between p-3 bg-surface-fill rounded-xl">
                <div>
                  <p className="text-subhead font-medium text-label-primary">Leave Family</p>
                  <p className="text-caption-1 text-label-secondary mt-0.5">
                    Remove yourself from this family. You will lose access to all family data.
                  </p>
                </div>
                <button
                  onClick={handleLeaveFamily}
                  disabled={saving}
                  className="btn-secondary shrink-0"
                >
                  Leave
                </button>
              </div>

              {/* Delete family (admin only) */}
              {userRole === 'parent' && (
                <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-xl">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-subhead font-medium text-label-primary">Delete Family</p>
                        <span className="px-2 py-0.5 bg-red-500/10 text-red-500 rounded text-caption-1 font-medium">Admin only</span>
                      </div>
                      <p className="text-caption-1 text-label-secondary mt-0.5">
                        Permanently delete this family and all associated data.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      disabled={saving}
                      className="btn-secondary shrink-0 border-red-500/30 text-red-500 hover:bg-red-500/10"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete</span>
                    </button>
                  </div>

                  {showDeleteConfirm && (
                    <div className="mt-3 p-3 bg-surface-base border border-red-500/20 rounded-xl">
                      <p className="text-footnote text-label-primary mb-3">
                        Are you absolutely sure you want to delete <strong>{familyName}</strong>?
                        This will permanently delete all chores, events, messages, and rewards.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="btn-secondary flex-1"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleDeleteFamily}
                          disabled={saving}
                          className="btn-primary bg-red-500 hover:bg-red-600 flex-1"
                        >
                          {saving ? 'Deleting…' : 'Yes, Delete'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}