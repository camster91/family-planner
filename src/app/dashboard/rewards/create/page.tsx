'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Save, Trophy, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function CreateRewardPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pointCost, setPointCost] = useState(10)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('You must be logged in')
        return
      }

      // Get user's family
      const { data: userData } = await supabase
        .from('users')
        .select('family_id, role')
        .eq('id', user.id)
        .single()

      if (!userData || userData.role !== 'parent') {
        setError('Only parents can create rewards')
        return
      }

      const { error: insertError } = await supabase
        .from('rewards')
        .insert({
          family_id: userData.family_id,
          title,
          description: description || null,
          point_cost: pointCost,
        })

      if (insertError) {
        setError(insertError.message)
        return
      }

      setSuccess('Reward created successfully!')
      
      // Redirect after a brief delay
      setTimeout(() => {
        router.push('/dashboard/rewards')
        router.refresh()
      }, 1500)
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
        href="/dashboard/rewards"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Rewards
      </Link>

      <div className="card">
        <div className="flex items-center mb-6">
          <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
            <Trophy className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Create New Reward</h2>
            <p className="text-gray-600">Create a reward that family members can earn with points</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              <div className="flex items-center">
                <AlertCircle className="w-5 h-5 mr-3" />
                {error}
              </div>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
              {success}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
              Reward Title *
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              placeholder="e.g., Extra Screen Time, Trip to Ice Cream Shop"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="input-field"
              placeholder="Describe the reward in detail..."
            />
            <p className="mt-2 text-sm text-gray-600">
              Be specific about what the reward entails and any conditions.
            </p>
          </div>

          <div>
            <label htmlFor="pointCost" className="block text-sm font-medium text-gray-700 mb-2">
              Point Cost *
            </label>
            <div className="flex items-center space-x-4">
              <input
                id="pointCost"
                type="range"
                min="5"
                max="500"
                step="5"
                value={pointCost}
                onChange={(e) => setPointCost(parseInt(e.target.value))}
                className="flex-1"
              />
              <div className="w-24 text-center">
                <div className="text-2xl font-bold text-gray-900">{pointCost}</div>
                <div className="text-sm text-gray-600">points</div>
              </div>
            </div>
            
            <div className="grid grid-cols-4 gap-2 mt-4">
              {[10, 25, 50, 100].map((points) => (
                <button
                  key={points}
                  type="button"
                  onClick={() => setPointCost(points)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                    pointCost === points
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {points}
                </button>
              ))}
            </div>

            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-medium text-blue-900 mb-2">Point Cost Guidelines</h4>
              <div className="space-y-2 text-sm text-blue-800">
                <div className="flex justify-between">
                  <span>Small rewards (screen time, treats):</span>
                  <span className="font-medium">10-25 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Medium rewards (outing, toy):</span>
                  <span className="font-medium">50-100 points</span>
                </div>
                <div className="flex justify-between">
                  <span>Large rewards (trip, big item):</span>
                  <span className="font-medium">150-500 points</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center pt-6 border-t">
            <div className="flex-1">
              <div className="flex items-center text-sm text-gray-600">
                <AlertCircle className="w-4 h-4 mr-2" />
                Only parents can create and manage rewards
              </div>
            </div>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="btn-primary inline-flex items-center"
            >
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Creating...' : 'Create Reward'}
            </button>
          </div>
        </form>
      </div>

      {/* Example Rewards */}
      <div className="mt-8 card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Reward Ideas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-medium text-gray-900">Extra Screen Time</h4>
              <span className="text-sm font-semibold text-blue-600">15 pts</span>
            </div>
            <p className="text-sm text-gray-600">
              30 minutes of extra screen time on the weekend
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-medium text-gray-900">Choose Dinner</h4>
              <span className="text-sm font-semibold text-blue-600">25 pts</span>
            </div>
            <p className="text-sm text-gray-600">
              Choose what the family has for dinner
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-medium text-gray-900">Ice Cream Trip</h4>
              <span className="text-sm font-semibold text-blue-600">50 pts</span>
            </div>
            <p className="text-sm text-gray-600">
              Family trip to the ice cream shop
            </p>
          </div>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="flex justify-between items-start mb-2">
              <h4 className="font-medium text-gray-900">Movie Night Choice</h4>
              <span className="text-sm font-semibold text-blue-600">75 pts</span>
            </div>
            <p className="text-sm text-gray-600">
              Choose the movie for family movie night
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}