'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, PlusCircle, Check } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

const PRESET_COLORS = [
  { value: '#3B82F6', label: 'Blue', ring: 'ring-blue-400' },
  { value: '#EC4899', label: 'Pink', ring: 'ring-pink-400' },
  { value: '#8B5CF6', label: 'Purple', ring: 'ring-purple-400' },
  { value: '#10B981', label: 'Green', ring: 'ring-emerald-400' },
  { value: '#F59E0B', label: 'Amber', ring: 'ring-amber-400' },
  { value: '#6366F1', label: 'Indigo', ring: 'ring-indigo-400' },
]

export default function CreateProjectPage() {
  const router = useRouter()
  const { addToast } = useToast()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0].value)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setLoading(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create project')

      addToast({ type: 'success', title: 'Project created!', message: `"${name.trim()}" is ready.` })
      router.push(`/dashboard/projects/${data.project.id}`)
      router.refresh()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to create project',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 pb-20">
      {/* Back */}
      <div className="px-4 pt-4">
        <Link href="/dashboard/projects" className="inline-flex items-center gap-1.5 text-subhead text-label-secondary hover:text-label-primary transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Back to Projects
        </Link>
      </div>

      {/* Header */}
      <div className="px-4">
        <h1 className="text-2xl font-bold text-label-primary">New Project</h1>
        <p className="text-subhead text-label-secondary mt-1">Organize family goals and tasks together.</p>
      </div>

      {/* Form card */}
      <div className="rounded-2xl bg-white border shadow-sm overflow-hidden mx-4">
        {/* Color preview bar */}
        <div className="h-1.5 w-full transition-colors duration-300" style={{ backgroundColor: color }} />

        <div className="p-6 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div className="space-y-1.5">
              <label htmlFor="name" className="text-subhead text-label-secondary">
                Project Name <span className="text-red-400">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Backyard Garden, Spring Cleaning"
                className="input-apple"
                required
                autoFocus
                maxLength={200}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="description" className="text-subhead text-label-secondary">
                Description <span className="text-label-tertiary">(optional)</span>
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this project about?"
                rows={2}
                className="input-apple resize-none"
                maxLength={1000}
              />
              <p className="text-caption-1 text-label-tertiary text-right">{description.length}/1000</p>
            </div>

            {/* Color picker */}
            <div className="space-y-2">
              <label className="text-subhead text-label-secondary">Accent Color</label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={cn(
                      'w-9 h-9 rounded-xl border-2 transition-all duration-150 flex items-center justify-center',
                      color === c.value
                        ? 'border-gray-900 ring-2 ring-offset-1 ring-gray-400'
                        : 'border-transparent hover:border-gray-300',
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                    aria-label={`Color: ${c.label}`}
                  >
                    {color === c.value && <Check className="w-4 h-4 text-white" strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!name.trim() || loading}
              className={cn(
                'w-full py-3 rounded-xl text-base font-semibold transition-all duration-200',
                name.trim() && !loading
                  ? 'bg-projects text-white hover:bg-projects/90'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed',
              )}
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Creating...
                </span>
              ) : (
                <span className="inline-flex items-center gap-2">
                  <PlusCircle className="w-4 h-4" />
                  Create Project
                </span>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Tip */}
      <div className="rounded-xl bg-surface-fill p-4 text-center mx-4">
        <p className="text-caption-1 text-label-secondary">
          After creating, you can add tasks, assign family members, and track progress.
        </p>
      </div>
    </div>
  )
}