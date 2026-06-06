'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users } from 'lucide-react'
import Link from 'next/link'
import { LargeHeader } from '@/components/ui/large-header'
import { Glyph } from '@/components/ui/glyph'

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
    <div className="pb-20">
      <LargeHeader
        title="New Family"
        trailing={
          <Glyph color="family" size="md">
            <Users className="w-4 h-4" />
          </Glyph>
        }
        className="px-4"
      />

      <div className="px-4">
        <div className="card-apple p-5">
          <form onSubmit={handleCreateFamily} className="space-y-6">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-4 py-3 rounded-xl text-subhead">
                {error}
              </div>
            )}

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
              <p className="mt-2 text-caption-1 text-label-secondary">
                Choose a name that represents your family. You can change this later.
              </p>
            </div>

            <div className="bg-surface-fill rounded-xl p-4">
              <h3 className="text-subhead font-semibold text-label-primary mb-2">What happens next?</h3>
              <ul className="text-footnote text-label-secondary space-y-1.5">
                <li>✓ You become the family admin (parent role)</li>
                <li>✓ You can invite other family members to join</li>
                <li>✓ Start creating chores and events right away</li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-2">
              <Link href="/dashboard" className="btn-secondary">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={loading || !familyName.trim()}
                className="btn-primary"
              >
                {loading ? 'Creating…' : 'Create Family'}
              </button>
            </div>
          </form>
        </div>

        <div className="mt-6 text-center">
          <p className="text-subhead text-label-secondary">
            Already have a family?{' '}
            <Link href="/join" className="text-[var(--accent)] font-medium">
              Join an existing family
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}