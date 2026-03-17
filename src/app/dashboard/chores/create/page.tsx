'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, PlusCircle } from 'lucide-react'
import Link from 'next/link'

export default function CreateChorePage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(10)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [difficulty, setDifficulty] = useState('medium')
  const [frequency, setFrequency] = useState('once')
  const [ageMin, setAgeMin] = useState<number | ''>('')
  const [ageMax, setAgeMax] = useState<number | ''>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const router = useRouter()

  // Load family members on component mount
  useEffect(() => {
    loadFamilyMembers()
  }, [])

  const loadFamilyMembers = async () => {
    try {
      const res = await fetch('/api/family/members')
      const data = await res.json()

      if (res.ok && data.members) {
        setFamilyMembers(data.members)
        if (data.members.length > 0 && !assignedTo) {
          setAssignedTo(data.members[0].id)
        }
      }
    } catch (err) {
      console.error('Error loading family members:', err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Combine date and time
      let dueDateTime = dueDate
      if (dueTime) {
        dueDateTime = `${dueDate}T${dueTime}`
      }

      const res = await fetch('/api/chores/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: description || null,
          points,
          assigned_to: assignedTo,
          due_date: dueDateTime,
          difficulty,
          frequency,
          age_min: ageMin || null,
          age_max: ageMax || null,
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to create chore')
        return
      }

      // Success - redirect to chores page
      router.push('/dashboard/chores')
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
        href="/dashboard/chores"
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-8"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Chores
      </Link>

      <div className="card">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
            <PlusCircle className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Create New Chore</h1>
          <p className="mt-2 text-gray-600">
            Assign a new chore or responsibility to a family member.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
              Chore Title *
            </label>
            <input
              id="title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input-field"
              placeholder="e.g., Take out the trash, Clean your room"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
              Description (Optional)
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input-field min-h-[100px]"
              placeholder="Provide clear instructions for this chore..."
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="points" className="block text-sm font-medium text-gray-700 mb-2">
                Points Reward
              </label>
              <div className="relative">
                <input
                  id="points"
                  type="number"
                  min="1"
                  max="1000"
                  value={points}
                  onChange={(e) => setPoints(parseInt(e.target.value) || 10)}
                  className="input-field pr-12"
                />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <span className="text-gray-500">pts</span>
                </div>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                Points can be redeemed for rewards
              </p>
            </div>

            <div>
              <label htmlFor="assignedTo" className="block text-sm font-medium text-gray-700 mb-2">
                Assign To *
              </label>
              <select
                id="assignedTo"
                required
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="input-field"
              >
                <option value="">Select family member</option>
                {familyMembers.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name} ({member.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-2">
                Due Date *
              </label>
              <input
                id="dueDate"
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="input-field"
                min={new Date().toISOString().split('T')[0]}
              />
            </div>

            <div>
              <label htmlFor="dueTime" className="block text-sm font-medium text-gray-700 mb-2">
                Due Time (Optional)
              </label>
              <input
                id="dueTime"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="input-field"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700 mb-2">
                Difficulty
              </label>
              <select
                id="difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="input-field"
              >
                <option value="easy">Easy (5-10 minutes)</option>
                <option value="medium">Medium (15-30 minutes)</option>
                <option value="hard">Hard (30+ minutes)</option>
              </select>
            </div>

            <div>
              <label htmlFor="frequency" className="block text-sm font-medium text-gray-700 mb-2">
                Frequency
              </label>
              <select
                id="frequency"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="input-field"
              >
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          {/* Age Range (Optional) */}
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Age Range (Optional)</h3>
            <p className="text-sm text-gray-600 mb-4">Set age limits for who should do this chore. Leave empty for all ages.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Minimum Age
                </label>
                <input
                  type="number"
                  min="0"
                  max="18"
                  value={ageMin}
                  onChange={(e) => setAgeMin(e.target.value === '' ? '' : parseInt(e.target.value))}
                  className="input-field"
                  placeholder="e.g., 5"
                />
                <p className="text-xs text-gray-500 mt-1">Youngest age for this chore</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Maximum Age
                </label>
                <input
                  type="number"
                  min="0"
                  max="18"
                  value={ageMax}
                  onChange={(e) => setAgeMax(e.target.value === '' ? '' : parseInt(e.target.value))}
                  className="input-field"
                  placeholder="e.g., 12"
                />
                <p className="text-xs text-gray-500 mt-1">Oldest age for this chore</p>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6 border-t">
            <Link
              href="/dashboard/chores"
              className="btn-secondary"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading || !title || !assignedTo || !dueDate}
              className="btn-primary"
            >
              {loading ? 'Creating...' : 'Create Chore'}
            </button>
          </div>
        </form>
      </div>

      <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-4">Creating Effective Chores</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium text-blue-800 mb-2">Clear Titles</h4>
            <p className="text-sm text-blue-700">
              Use specific, actionable titles like "Vacuum living room" instead of "Clean house".
            </p>
          </div>
          <div>
            <h4 className="font-medium text-blue-800 mb-2">Age-Appropriate</h4>
            <p className="text-sm text-blue-700">
              Match chore difficulty to the child's age and ability level for best results.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-blue-800 mb-2">Reasonable Points</h4>
            <p className="text-sm text-blue-700">
              Assign points based on time and difficulty to motivate completion.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-blue-800 mb-2">Clear Deadlines</h4>
            <p className="text-sm text-blue-700">
              Set realistic due dates to create accountability without pressure.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
