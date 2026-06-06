'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Camera } from 'lucide-react'
import Link from 'next/link'
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

export default function CreateChorePage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(10)
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [difficulty, setDifficulty] = useState<Difficulty>('medium')
  const [frequency, setFrequency] = useState<Frequency>('once')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [familyMembers, setFamilyMembers] = useState<{ id: string; name: string; role: string }[]>([])
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [photoUploading, setPhotoUploading] = useState(false)

  useEffect(() => {
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
    loadFamilyMembers()
  }, [assignedTo])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/chores/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
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
        setError(data.error || 'Failed to create chore')
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
        <h1 className="text-large-title font-display">New Chore</h1>
        <p className="text-subhead text-label-secondary mt-1">Assign a task to a family member.</p>
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
            min={new Date().toISOString().split('T')[0]}
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
          {frequency !== 'once' && (
            <p className="text-footnote text-label-tertiary mt-1.5">
              This chore will repeat {frequency === 'daily' ? '7 times' : frequency === 'weekly' ? '4 times' : '3 times'}
            </p>
          )}
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
            {loading ? 'Creating...' : 'Create Chore'}
          </button>
        </div>
      </form>
    </div>
  )
}