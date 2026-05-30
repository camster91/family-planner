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
    <div className="max-w-lg mx-auto space-y-6">
      {/* Back link */}
      <Link
        href="/dashboard/projects"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to projects
      </Link>

      {/* Form card */}
      <div className="rounded-2xl bg-white border shadow-sm overflow-hidden">
        {/* Color preview bar */}
        <div className="h-2 w-full transition-colors duration-300" style={{ backgroundColor: color }} />

        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <PlusCircle className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">New Project</h1>
              <p className="text-xs text-gray-500">Create a new family project</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name */}
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1.5">
                Project Name <span className="text-red-400">*</span>
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Backyard Garden, Spring Cleaning"
                className="input-field rounded-xl"
                required
                autoFocus
                maxLength={200}
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1.5">
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this project about? (optional)"
                rows={3}
                className="input-field rounded-xl resize-none"
                maxLength={1000}
              />
              <p className="mt-1 text-xs text-gray-400 text-right">
                {description.length}/1000
              </p>
            </div>

            {/* Color picker */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Accent Color
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={cn(
                      'w-9 h-9 rounded-xl border-2 transition-all duration-150 flex items-center justify-center',
                      color === c.value
                        ? `border-gray-900 ring-2 ring-offset-1 ${c.ring}`
                        : 'border-transparent hover:border-gray-300',
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                    aria-label={`Color: ${c.label}`}
                  >
                    {color === c.value && (
                      <Check className="w-4 h-4 text-white" strokeWidth={3} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={!name.trim() || loading}
              className={cn(
                'w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200',
                name.trim() && !loading
                  ? 'text-white bg-blue-500 hover:bg-blue-600 shadow-sm'
                  : 'text-gray-400 bg-gray-100 cursor-not-allowed',
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
      <div className="rounded-xl bg-gray-50 p-4 text-center">
        <p className="text-xs text-gray-500">
          After creating the project, you can add tasks, assign family members,
          set due dates, and track progress together.
        </p>
      </div>
    </div>
  )
}
