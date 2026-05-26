'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Gift, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function CreateRewardPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [cost, setCost] = useState(50)
  const [icon, setIcon] = useState('🎁')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/rewards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: name,
          description: description || undefined,
          point_cost: cost,
          icon,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create reward')
        return
      }

      router.push('/dashboard/rewards')
      router.refresh()
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const iconOptions = ['🎁', '🎮', '🍕', '🍦', '🎬', '📚', '⏰', '💰', '🏆', '⭐']

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/dashboard/rewards" className="inline-flex items-center text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Rewards
        </Link>
      </div>

      <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Reward</h1>
      <p className="text-gray-600 mb-8">Set up a reward that family members can claim with their earned XP.</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Reward Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., Extra Video Game Time"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Description (optional)</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="e.g., 30 minutes of extra gaming on the weekend"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">XP Cost</label>
          <div className="flex items-center gap-4">
            <input
              type="number"
              value={cost}
              onChange={e => setCost(Math.max(1, parseInt(e.target.value) || 0))}
              min={1}
              required
              className="w-32 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <span className="text-gray-600">XP</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">How much XP is needed to claim this reward.</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Icon</label>
          <div className="flex flex-wrap gap-2">
            {iconOptions.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-colors ${
                  icon === emoji
                    ? 'bg-blue-100 border-2 border-blue-500'
                    : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 pt-4">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Reward'}
          </button>
          <Link
            href="/dashboard/rewards"
            className="px-6 py-3 text-gray-600 hover:text-gray-900 font-medium"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
