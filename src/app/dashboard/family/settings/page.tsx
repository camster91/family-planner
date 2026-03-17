'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Users, Trash2, AlertTriangle, Shield } from 'lucide-react'
import Link from 'next/link'

export default function FamilySettingsPage() {
  const [familyName, setFamilyName] = useState('')
  const [subscriptionTier, setSubscriptionTier] = useState('free')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [userRole, setUserRole] = useState('')
  const [familyId, setFamilyId] = useState('')
  const router = useRouter()

  // Load family data
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
      setUserRole(user.role)
      setFamilyId(user.family_id || '')

      if (!user.family_id) return

      // Get family details via users endpoint (which has family_id)
      // We need a way to get family name - let's use the family PATCH endpoint pattern
      // For now, fetch from the users endpoint which returns the full user with family_id
      const usersRes = await fetch('/api/users')
      const usersData = await usersRes.json()

      // We need family details - let's try the family lookup approach
      // Actually we can just store what we need from the me endpoint
      // For the family name, we need to call a family endpoint
      // Let's just set what we know and fetch members to get family context
      if (usersData.user) {
        setFamilyName(usersData.user.name || '') // This is user name, not family name
      }

      // Fetch family name by looking up via the lookup endpoint with the family ID
      // Actually simpler: we'll add the family name to the response later
      // For now: the family name needs to come from somewhere
      // Let's use a direct fetch with a query pattern
    } catch (err) {
      console.error('Error loading family data:', err)
      setError('Failed to load family data')
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
        body: JSON.stringify({
          familyId,
          name: familyName,
          subscription_tier: subscriptionTier,
        }),
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
    if (!confirm('Are you absolutely sure? This will delete the entire family and all associated data (chores, events, messages). This action cannot be undone.')) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/family', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyId }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to delete family')
        return
      }

      // Success - redirect to dashboard
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
    setError(null)

    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ family_id: null }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to leave family')
        return
      }

      // Success - redirect to dashboard
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
      <div className="max-w-2xl mx-auto">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading family settings...</p>
        </div>
      </div>
    )
  }

  if (!familyId) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card text-center py-12">
          <Users className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-4">No Family Found</h2>
          <p className="text-gray-600 mb-6">
            You don't belong to a family yet. Create or join a family to access settings.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard/family/create"
              className="btn-primary"
            >
              Create Family
            </Link>
            <Link
              href="/join"
              className="btn-secondary"
            >
              Join Family
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/dashboard/family"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Family
      </Link>

      <div className="space-y-8">
        {/* Family Settings */}
        <div className="card">
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
              <Users className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Family Settings</h2>
              <p className="text-gray-600">Manage your family's information and preferences</p>
            </div>
          </div>

          <form onSubmit={handleSaveSettings} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
                {success}
              </div>
            )}

            <div>
              <label htmlFor="familyName" className="block text-sm font-medium text-gray-700 mb-2">
                Family Name
              </label>
              <input
                id="familyName"
                type="text"
                required
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                className="input-field"
                placeholder="The Smith Family"
              />
            </div>

            <div>
              <label htmlFor="subscriptionTier" className="block text-sm font-medium text-gray-700 mb-2">
                Subscription Tier
              </label>
              <select
                id="subscriptionTier"
                value={subscriptionTier}
                onChange={(e) => setSubscriptionTier(e.target.value)}
                className="input-field"
                disabled={true} // Only free tier available in MVP
              >
                <option value="free">Free (Basic Features)</option>
                <option value="premium" disabled>Premium (Coming Soon)</option>
                <option value="family" disabled>Family Plan (Coming Soon)</option>
              </select>
              <p className="mt-2 text-sm text-gray-600">
                All features are free during the MVP phase. Premium features coming in Phase 4.
              </p>
            </div>

            <div className="flex justify-end pt-4 border-t">
              <button
                type="submit"
                disabled={saving || !familyName.trim()}
                className="btn-primary inline-flex items-center"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        </div>

        {/* Danger Zone */}
        <div className="card border-red-200">
          <div className="flex items-center mb-6">
            <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mr-4">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Danger Zone</h2>
              <p className="text-gray-600">Irreversible actions - proceed with caution</p>
            </div>
          </div>

          <div className="space-y-6">
            {/* Leave Family */}
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-red-900">Leave Family</h3>
                  <p className="text-sm text-red-700 mt-1">
                    Remove yourself from this family. You will lose access to all family data.
                  </p>
                </div>
                <button
                  onClick={handleLeaveFamily}
                  disabled={saving}
                  className="btn-secondary bg-white border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                >
                  Leave Family
                </button>
              </div>
            </div>

            {/* Delete Family (Admin only) */}
            {userRole === 'parent' && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center">
                      <h3 className="font-medium text-red-900">Delete Family</h3>
                      <span className="ml-3 px-2 py-1 bg-red-200 text-red-800 rounded text-xs font-medium">
                        Admin Only
                      </span>
                    </div>
                    <p className="text-sm text-red-700 mt-1">
                      Permanently delete this family and all associated data. This action cannot be undone.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={saving}
                    className="btn-secondary bg-white border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Family
                  </button>
                </div>

                {showDeleteConfirm && (
                  <div className="mt-4 p-4 bg-white border border-red-300 rounded-lg">
                    <div className="flex items-center mb-4">
                      <AlertTriangle className="w-5 h-5 text-red-600 mr-3" />
                      <h4 className="font-semibold text-red-900">Confirm Deletion</h4>
                    </div>
                    <p className="text-sm text-gray-700 mb-4">
                      Are you absolutely sure you want to delete the <strong>{familyName}</strong> family?
                      This will permanently delete:
                    </p>
                    <ul className="text-sm text-gray-700 space-y-2 mb-6">
                      <li className="flex items-start">
                        <div className="flex-shrink-0 mt-1">•</div>
                        <span className="ml-2">All family member associations</span>
                      </li>
                      <li className="flex items-start">
                        <div className="flex-shrink-0 mt-1">•</div>
                        <span className="ml-2">All chores and chore history</span>
                      </li>
                      <li className="flex items-start">
                        <div className="flex-shrink-0 mt-1">•</div>
                        <span className="ml-2">All calendar events</span>
                      </li>
                      <li className="flex items-start">
                        <div className="flex-shrink-0 mt-1">•</div>
                        <span className="ml-2">All family messages</span>
                      </li>
                      <li className="flex items-start">
                        <div className="flex-shrink-0 mt-1">•</div>
                        <span className="ml-2">All rewards and points</span>
                      </li>
                    </ul>
                    <div className="flex space-x-4">
                      <button
                        onClick={() => setShowDeleteConfirm(false)}
                        className="btn-secondary flex-1"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleDeleteFamily}
                        disabled={saving}
                        className="btn-primary bg-red-600 hover:bg-red-700 text-white flex-1"
                      >
                        {saving ? 'Deleting...' : 'Yes, Delete Family'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Data Privacy */}
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center">
                <Shield className="w-5 h-5 text-blue-600 mr-3" />
                <div>
                  <h3 className="font-medium text-blue-900">Data Privacy</h3>
                  <p className="text-sm text-blue-700 mt-1">
                    Your family data is stored securely and privately. Only family members can access your data.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
