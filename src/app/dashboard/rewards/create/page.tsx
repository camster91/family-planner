'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'

const ICON_OPTIONS = ['🎁', '🎮', '🍕', '🍦', '🎬', '📚', '⏰', '💰', '🏆', '⭐']

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
          name,
          description: description || undefined,
          cost,
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

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-20">
      {/* Back */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/rewards" className="inline-flex items-center gap-1.5 text-subhead text-label-secondary hover:text-label-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Rewards
        </Link>
      </div>

      {/* Header */}
      <div className="px-4">
        <h1 className="text-2xl font-bold text-label-primary">New Reward</h1>
        <p className="text-subhead text-label-secondary mt-1">Create a reward for your family.</p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-5 px-4">
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700 text-sm">{error}</div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="name" className="text-subhead text-label-secondary">Name</label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            placeholder="e.g., Extra Video Game Time"
            className="input-apple"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="description" className="text-subhead text-label-secondary">Description <span className="text-label-tertiary">(optional)</span></label>
          <textarea
            id="description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="e.g., 30 minutes of extra gaming on the weekend"
            className="input-apple resize-none"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="cost" className="text-subhead text-label-secondary">XP Cost</label>
          <div className="flex items-center gap-3">
            <input
              id="cost"
              type="number"
              value={cost}
              onChange={e => setCost(Math.max(1, parseInt(e.target.value) || 0))}
              min={1}
              required
              className="input-apple w-28"
            />
            <span className="text-subhead text-label-secondary">XP</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-subhead text-label-secondary">Icon</label>
          <div className="flex flex-wrap gap-2">
            {ICON_OPTIONS.map(emoji => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                className={`w-11 h-11 rounded-xl text-xl flex items-center justify-center transition-all duration-150 ${
                  icon === emoji
                    ? 'bg-rewards text-white ring-2 ring-rewards ring-offset-1'
                    : 'bg-surface-fill text-label-secondary hover:bg-gray-200'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="pt-4">
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="btn-tinted bg-rewards w-full py-3 text-base font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Reward'}
          </button>
        </div>
      </form>
    </div>
  )
}