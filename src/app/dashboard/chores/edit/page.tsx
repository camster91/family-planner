'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'

function EditChoreForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(10)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [difficulty, setDifficulty] = useState('medium')
  const [frequency, setFrequency] = useState('once')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [familyMembers, setFamilyMembers] = useState<any[]>([])
  const router = useRouter()
  const searchParams = useSearchParams()
  const choreId = searchParams.get('id')

  useEffect(() => {
    if (!choreId) {
      setError('No chore ID provided')
      setFetching(false)
      return
    }

    const fetchData = async () => {
      try {
        const [choreRes, membersRes] = await Promise.all([
          fetch('/api/chores'),
          fetch('/api/family/members'),
        ])

        if (choreRes.ok) {
          const choresData = await choreRes.json()
          const chore = choresData.chores?.find((c: any) => c.id === choreId)
          if (chore) {
            setTitle(chore.title)
            setDescription(chore.description || '')
            setPoints(chore.points)
            setAssignedTo(chore.assigned_to)
            const d = new Date(chore.due_date)
            setDueDate(d.toISOString().split('T')[0])
            setDueTime(d.toISOString().split('T')[1]?.substring(0, 5) || '')
            setDifficulty(chore.difficulty || 'medium')
            setFrequency(chore.frequency || 'once')
          } else {
            setError('Chore not found')
          }
        }

        if (membersRes.ok) {
          const membersData = await membersRes.json()
          if (membersData.members) {
            setFamilyMembers(membersData.members)
          }
        }
      } catch (err) {
        console.error('Error fetching chore:', err)
        setError('Failed to load chore data')
      } finally {
        setFetching(false)
      }
    }

    fetchData()
  }, [choreId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!choreId) return

    setLoading(true)
    setError(null)

    try {
      let dueDateTime = dueDate
      if (dueTime) {
        dueDateTime = `${dueDate}T${dueTime}`
      }

      const res = await fetch('/api/chores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choreId,
          title,
          description: description || null,
          points,
          assigned_to: assignedTo,
          due_date: dueDateTime,
          difficulty,
          frequency,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to update chore')
        return
      }

      router.push('/dashboard/chores')
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
        <p className="mt-4 text-gray-600">Loading chore data...</p>
      </div>
    )
  }

  if (!choreId) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card text-center py-12">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">No Chore Selected</h2>
          <p className="text-gray-600 mb-6">Please select a chore to edit.</p>
          <Link href="/dashboard/chores" className="btn-primary">Back to Chores</Link>
        </div>
      </div>
    )
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
          <h1 className="text-3xl font-bold text-gray-900">Edit Chore</h1>
          <p className="mt-2 text-gray-600">Update the chore details below.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">Chore Title *</label>
            <input id="title" type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className="input-field" placeholder="e.g., Take out the trash" />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">Description (Optional)</label>
            <textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} className="input-field min-h-[100px]" placeholder="Provide instructions..." rows={3} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="points" className="block text-sm font-medium text-gray-700 mb-2">Points Reward</label>
              <div className="relative">
                <input id="points" type="number" min="1" max="1000" value={points} onChange={(e) => setPoints(parseInt(e.target.value) || 10)} className="input-field pr-12" />
                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                  <span className="text-gray-500">pts</span>
                </div>
              </div>
            </div>

            <div>
              <label htmlFor="assignedTo" className="block text-sm font-medium text-gray-700 mb-2">Assign To *</label>
              <select id="assignedTo" required value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="input-field">
                <option value="">Select family member</option>
                {familyMembers.map((member) => (
                  <option key={member.id} value={member.id}>{member.name} ({member.role})</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-2">Due Date *</label>
              <input id="dueDate" type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label htmlFor="dueTime" className="block text-sm font-medium text-gray-700 mb-2">Due Time (Optional)</label>
              <input id="dueTime" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className="input-field" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="difficulty" className="block text-sm font-medium text-gray-700 mb-2">Difficulty</label>
              <select id="difficulty" value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="input-field">
                <option value="easy">Easy (5-10 minutes)</option>
                <option value="medium">Medium (15-30 minutes)</option>
                <option value="hard">Hard (30+ minutes)</option>
              </select>
            </div>
            <div>
              <label htmlFor="frequency" className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
              <select id="frequency" value={frequency} onChange={(e) => setFrequency(e.target.value)} className="input-field">
                <option value="once">Once</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between pt-6 border-t">
            <Link href="/dashboard/chores" className="btn-secondary">Cancel</Link>
            <button type="submit" disabled={loading || !title || !assignedTo || !dueDate} className="btn-primary">
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function EditChorePage() {
  return (
    <Suspense fallback={<div className="text-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div><p className="mt-4 text-gray-600">Loading...</p></div>}>
      <EditChoreForm />
    </Suspense>
  )
}