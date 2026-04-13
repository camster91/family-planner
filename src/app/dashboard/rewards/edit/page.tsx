'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Gift } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'

function EditRewardForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pointCost, setPointCost] = useState(10)
  const [icon, setIcon] = useState('gift')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const rewardId = searchParams.get('id')

  useEffect(() => {
    if (!rewardId) {
      setError('No reward ID provided')
      setFetching(false)
      return
    }

    const fetchReward = async () => {
      try {
        const res = await fetch('/api/rewards')
        if (res.ok) {
          const data = await res.json()
          const reward = data.rewards?.find((r: any) => r.id === rewardId)
          if (reward) {
            setTitle(reward.title)
            setDescription(reward.description || '')
            setPointCost(reward.point_cost)
            setIcon(reward.icon || 'gift')
          } else {
            setError('Reward not found')
          }
        }
      } catch (err) {
        console.error('Error fetching reward:', err)
        setError('Failed to load reward data')
      } finally {
        setFetching(false)
      }
    }

    fetchReward()
  }, [rewardId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rewardId) return

    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/rewards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rewardId,
          title,
          description: description || null,
          point_cost: pointCost,
          icon,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update reward')
        return
      }

      router.push('/dashboard/rewards')
      router.refresh()
    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading reward data...</p>
      </div>
    )
  }

  if (!rewardId) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">No Reward Selected</h2>
          <p className="text-gray-600 mb-6">Please select a reward to edit.</p>
          <Link href="/dashboard/rewards" className="btn-primary">Back to Rewards</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        href="/dashboard/rewards"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Rewards
      </Link>

      <div className="card">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <Gift className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Edit Reward</h1>
          <p className="mt-2 text-gray-600">Update the reward details below.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">{error}</div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">Reward Title *</label>
            <input id="title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="e.g., Movie night, Extra screen time" />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">Description (Optional)</label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="input-field min-h-[100px]" placeholder="Describe what this reward includes..." rows={3} />
          </div>

          <div>
            <label htmlFor="pointCost" className="block text-sm font-medium text-gray-700 mb-2">Point Cost *</label>
            <div className="relative">
              <input id="pointCost" type="number" min="1" max="100000" required value={pointCost} onChange={(e) => setPointCost(parseInt(e.target.value) || 1)} className="input-field pr-12" />
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <span className="text-gray-500">pts</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6 border-t">
            <Link href="/dashboard/rewards" className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={loading || !title || pointCost < 1} className="btn-primary">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function EditRewardPage() {
  return (
    <Suspense fallback={<div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div><p className="mt-4 text-gray-600">Loading...</p></div>}>
      <EditRewardForm />
    </Suspense>
  )
}