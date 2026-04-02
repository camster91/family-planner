'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function CreateFamilyPage() {
  const [familyName, setFamilyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: familyName }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create family')
        return
      }

      // Success - redirect to dashboard
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/dashboard"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Dashboard
      </Link>

      <div className="card">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
            <Users className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Create Your Family</h1>
          <p className="mt-2 text-gray-600">
            Set up your family group to start organizing your family life together.
          </p>
        </div>

        <form onSubmit={handleCreateFamily} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              {error}
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
              placeholder="e.g., The Smith Family"
            />
            <p className="mt-2 text-sm text-gray-500">
              Choose a name that represents your family. You can change this later.
            </p>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-medium text-blue-900 mb-2">What happens next?</h3>
            <ul className="text-sm text-blue-800 space-y-2">
              <li className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">✓</div>
                <span className="ml-2">You&apos;ll become the family admin (parent role)</span>
              </li>
              <li className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">✓</div>
                <span className="ml-2">You can invite other family members to join</span>
              </li>
              <li className="flex items-start">
                <div className="flex-shrink-0 mt-0.5">✓</div>
                <span className="ml-2">Start creating chores and events right away</span>
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-between pt-6 border-t">
            <Link
              href="/dashboard"
              className="btn-secondary"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !familyName.trim()}
              className="btn-primary"
            >
              {loading ? 'Creating...' : 'Create Family'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-8 text-center text-sm text-gray-500">
        <p>
          Already have a family?{' '}
          <Link href="/dashboard/family/join" className="text-blue-600 hover:text-blue-500 font-medium">
            Join an existing family
          </Link>
        </p>
      </div>
    </div>
  )
}
