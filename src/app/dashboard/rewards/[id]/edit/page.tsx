'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { ArrowLeft, Save, Trophy, AlertCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function EditRewardPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [pointCost, setPointCost] = useState(10)
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const { id } = useParams()
  const supabase = createClient()

  useEffect(() => {
    const fetchReward = async () => {
      const { data, error } = await supabase
        .from('rewards')
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        setError('Failed to fetch reward')
        setFetching(false)
        return
      }

      setTitle(data.title)
      setDescription(data.description || '')
      setPointCost(data.point_cost)
      setFetching(false)
    }

    fetchReward()
  }, [id, supabase])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error: updateError } = await supabase
        .from('rewards')
        .update({
          title,
          description: description || null,
          point_cost: pointCost,
        })
        .eq('id', id)

      if (updateError) {
        setError(updateError.message)
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
      <div className="flex justify-center items-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
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
        <div className="flex items-center mb-6">
          <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
            <Trophy className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900">Edit Reward</h2>
            <p className="text-gray-600">Update the details for this reward</p>
          </div>
        </div>

        {error && <div className="mb-4 text-red-600 bg-red-50 p-3 rounded">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} required className="input-field" />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} className="input-field min-h-[100px]" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Point Cost</label>
            <input type="number" value={pointCost} onChange={(e) => setPointCost(parseInt(e.target.value))} min="1" required className="input-field" />
          </div>

          <div className="flex justify-end space-x-3 pt-6">
            <Link href="/dashboard/rewards" className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={loading} className="btn-primary">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}