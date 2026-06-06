'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Camera } from 'lucide-react'
import Link from 'next/link'
import { Suspense } from 'react'
import { cn } from '@/lib/utils'

type Difficulty = 'easy' | 'medium' | 'hard'
type Frequency = 'once' | 'daily' | 'weekly' | 'monthly'

const difficultyOptions: { value: Difficulty; label: string; description: string }[] = [
  { value: 'easy', label: 'Easy', description: '5–10 min' },
  { value: 'medium', label: 'Medium', description: '15–30 min' },
  { value: 'hard', label: 'Hard', description: '30+ min' },
]

const frequencyOptions: { value: Frequency; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

function EditChoreForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(10)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [frequency, setFrequency] = useState<Frequency>('once')
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [familyMembers, setFamilyMembers] = useState<{ id: string; name: string; role: string }[]>([])
  const router = useRouter()
  const searchParams = useSearchParams()
  const choreId = searchParams.get('id')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)

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
            setDifficulty(chore.difficulty || 'medium')
            setFrequency(chore.frequency || 'once')
            if (chore.photo_url) {
              setPhotoUrl(chore.photo_url)
              setPhotoPreview(chore.photo_url)
            }
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
      const res = await fetch('/api/chores', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          choreId,
          title,
          description: description || null,
          points,
          assigned_to: assignedTo,
          due_date: dueDate,
          difficulty,
          frequency,
          photo_url: photoUrl,
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
      <div className="flex items-center justify-center py-20">
        <div className="text-label-secondary">Loading...</div>
      </div>
    )
  }

  if (!choreId) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center">
        <div className="card-apple p-8">
          <h2 className="text-title-2 text-label-primary mb-2">No Chore Selected</h2>
          <p className="text-body text-label-secondary mb-6">Please select a chore to edit.</p>
          <Link href="/dashboard/chores" className="btn-filled">Back to Chores</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto pb-20">
      {/* Back nav */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/chores" className="btn-plain text-base py-2">
          <ArrowLeft className="w-5 h-5" />
          <span>Chores</span>
        </Link>
      </div>

      <div className="px-4 pt-4">
        <h1 className="text-large-title font-display">Edit Chore</h1>
        <p className="text-subhead text-label-secondary mt-1">Update the chore details.</p>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 px-4">

        {error && (
          <div className="card-apple p-4 border border-[var(--danger)]">
            <p className="text-body text-[var(--danger)]">{error}</p>
          </div>
        )}

        {/* Title */}
        <div>
          <label className="label-apple" htmlFor="title">Title</label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="input-apple"
            placeholder="e.g., Take out the trash"
          />
        </div>

        {/* Description */}
        <div>
          <label className="label-apple" htmlFor="description">Description</label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input-apple min-h-[80px] resize-none"
            placeholder="Instructions or details..."
            rows={3}
          />
        </div>

        {/* Points + Assignee row */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label-apple" htmlFor="points">Points</label>
            <input
              id="points"
              type="number"
              min="1"
              max="1000"
              value={points}
              onChange={(e) => setPoints(parseInt(e.target.value) || 10)}
              className="input-apple"
            />
          </div>
          <div>
            <label className="label-apple" htmlFor="assignedTo">Assign To</label>
            <select
              id="assignedTo"
              required
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="input-apple"
            >
              {familyMembers.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Due Date */}
        <div>
          <label className="label-apple" htmlFor="dueDate">Due Date</label>
          <input
            id="dueDate"
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="input-apple"
          />
        </div>

        {/* Difficulty picker */}
        <div>
          <label className="label-apple">Difficulty</label>
          <div className="grid grid-cols-3 gap-2">
            {difficultyOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDifficulty(opt.value)}
                className={cn(
                  'py-3 rounded-[var(--radius-md)] border text-center transition-all duration-200',
                  difficulty === opt.value
                    ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]'
                    : 'border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-primary'
                )}
              >
                <div className="text-body font-semibold">{opt.label}</div>
                <div className="text-caption-1 text-label-secondary mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Frequency picker */}
        <div>
          <label className="label-apple">Frequency</label>
          <div className="flex bg-[var(--surface-fill)] rounded-lg p-1 gap-1">
            {frequencyOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setFrequency(opt.value)}
                className={cn(
                  'flex-1 py-2 rounded-md text-sm font-medium transition-all duration-200',
                  frequency === opt.value
                    ? 'bg-[var(--surface-elevated)] text-label-primary shadow-sm'
                    : 'text-label-secondary hover:text-label-primary'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Photo attach */}
        <div>
          <label className="label-apple">Photo</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setPhotoUploading(true)
              try {
                const fd = new FormData()
                fd.append('file', file)
                const res = await fetch('/api/upload', { method: 'POST', body: fd })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Upload failed')
                setPhotoUrl(data.url)
                setPhotoPreview(data.url)
              } catch (err) {
                console.error('Photo upload error:', err)
                alert('Failed to upload photo')
              } finally {
                setPhotoUploading(false)
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={photoUploading}
            className={cn(
              'w-full py-3 rounded-[var(--radius-md)] border transition-all duration-200 text-center',
              photoPreview
                ? 'border-[var(--success)] bg-[var(--success-tint)] text-[var(--success)]'
                : 'border-[var(--surface-separator)] bg-[var(--surface-fill)] text-label-secondary'
            )}
          >
            {photoUploading ? (
              <span className="text-sm">Uploading...</span>
            ) : photoPreview ? (
              <span className="text-sm">Photo selected</span>
            ) : (
              <>
                <Camera className="w-5 h-5 mx-auto mb-1" />
                <span className="text-sm">Add photo</span>
              </>
            )}
          </button>
          {photoPreview && (
            <div className="mt-2 relative w-24 h-24 rounded-[var(--radius-md)] overflow-hidden border border-[var(--surface-separator)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => { setPhotoUrl(null); setPhotoPreview(null) }}
                className="absolute top-1 right-1 w-5 h-5 bg-[var(--danger)] rounded-full flex items-center justify-center"
              >
                <span className="text-white text-xs">✕</span>
              </button>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="pt-2">
          <button
            type="submit"
            disabled={loading || !title || !assignedTo || !dueDate}
            className="btn-filled w-full"
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function EditChorePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="text-label-secondary">Loading...</div>
      </div>
    }>
      <EditChoreForm />
    </Suspense>
  )
}