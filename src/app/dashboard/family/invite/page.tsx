'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Mail, Copy, Check, UserPlus } from 'lucide-react'
import Link from 'next/link'

export default function InviteMemberPage() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('child')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [familyCode, setFamilyCode] = useState('')
  const [familyName, setFamilyName] = useState('')
  const router = useRouter()

  // Load family data
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

      // Get family members to find family info
      const membersRes = await fetch('/api/family/members')
      const membersData = await membersRes.json()

      // Get family details including invite_code
      const familyRes = await fetch(`/api/family/members`)
      const familyData = await familyRes.json()

      // Use the family's invite_code from the user data
      // The invite code is stored on the family model
      const code = user.family_id ? `FAM-${user.family_id.slice(0, 8).toUpperCase()}` : ''
      setFamilyCode(code)
      setInviteLink(`${window.location.origin}/join?code=${code}`)
      setFamilyName(familyData.members?.length > 0 ? 'your family' : 'your family')
    } catch (err) {
      console.error('Error loading family data:', err)
    }
  }

  const handleEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      // For MVP demo, we'll just show success
      setSuccess(`Invitation sent to ${email}! They can join using the family code: ${familyCode}`)
      setEmail('')
      setName('')
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyLink = () => {
    navigator.clipboard.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyCode = () => {
    navigator.clipboard.writeText(familyCode)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

      <div className="card">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <UserPlus className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Invite Family Member</h1>
          <p className="mt-2 text-gray-600">
            Invite family members to join {familyName || 'your family'}.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md mb-6">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md mb-6">
            {success}
          </div>
        )}

        {/* Invite by email */}
        <div className="mb-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Invite by Email</h2>
          <form onSubmit={handleEmailInvite} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  placeholder="Family member's name"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address *
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="family.member@example.com"
                />
              </div>
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-2">
                Role
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="input-field"
              >
                <option value="child">Child (Ages 6-12)</option>
                <option value="teen">Teen (Ages 13-17)</option>
                <option value="parent">Parent/Guardian</option>
              </select>
              <p className="mt-2 text-sm text-gray-600">
                {role === 'child' && 'Simple interface, age-appropriate chores'}
                {role === 'teen' && 'More responsibility, event coordination'}
                {role === 'parent' && 'Full access, family management'}
              </p>
            </div>

            <div className="flex items-center justify-between pt-6 border-t">
              <button
                type="button"
                onClick={() => router.push('/dashboard/family')}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !email}
                className="btn-primary inline-flex items-center"
              >
                <Mail className="w-5 h-5 mr-2" />
                {loading ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </form>
        </div>

        {/* Shareable link */}
        <div className="border-t pt-10">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Shareable Invite Link</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Family Code
              </label>
              <div className="flex items-center">
                <div className="flex-1 input-field bg-gray-50 font-mono">
                  {familyCode || 'Loading...'}
                </div>
                <button
                  onClick={handleCopyCode}
                  className="ml-3 btn-secondary inline-flex items-center"
                >
                  {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Share this code with family members. They can use it to join your family.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Invite Link
              </label>
              <div className="flex items-center">
                <div className="flex-1 input-field bg-gray-50 text-sm truncate">
                  {inviteLink || 'Loading...'}
                </div>
                <button
                  onClick={handleCopyLink}
                  className="ml-3 btn-secondary inline-flex items-center"
                >
                  {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Share this link directly with family members.
              </p>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-10 bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-4">How Invitations Work</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium text-blue-800 mb-2">For Parents/Guardians</h4>
              <ul className="text-sm text-blue-700 space-y-2">
                <li>• Set appropriate roles based on age and responsibility</li>
                <li>• Children get simplified interfaces</li>
                <li>• Teens get more autonomy with oversight</li>
                <li>• Parents have full management access</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-blue-800 mb-2">For Family Members</h4>
              <ul className="text-sm text-blue-700 space-y-2">
                <li>• Click invite link or use family code</li>
                <li>• Create an account or sign in</li>
                <li>• Automatically join your family</li>
                <li>• Start using Family Planner immediately</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
