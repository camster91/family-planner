'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Archive, Trash2, MoreHorizontal, CheckCircle2, RotateCcw } from 'lucide-react'
import { useToast } from '@/components/ui/toast'

interface ProjectDetailActionsProps {
  projectId: string
  projectStatus: 'active' | 'completed' | 'archived'
  isParent: boolean
}

export function ProjectDetailActions({
  projectId,
  projectStatus,
  isParent,
}: ProjectDetailActionsProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)

  const updateStatus = async (status: 'active' | 'completed' | 'archived') => {
    setLoading(status)
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update project')

      addToast({
        type: 'success',
        title: status === 'completed' ? 'Project completed!' : status === 'archived' ? 'Project archived' : 'Project reactivated',
      })
      router.refresh()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to update project',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
    } finally {
      setLoading(null)
      setMenuOpen(false)
    }
  }

  const deleteProject = async () => {
    if (!confirm('Are you sure you want to delete this project? This will also delete all its tasks and cannot be undone.')) return
    setLoading('delete')
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete project')
      }
      addToast({ type: 'success', title: 'Project deleted' })
      router.push('/dashboard/projects')
      router.refresh()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Failed to delete',
        message: error instanceof Error ? error.message : 'Please try again.',
      })
      setLoading(null)
    }
  }

  interface Action {
    label: string
    icon: React.ComponentType<{ className?: string }>
    onClick: () => void
    loading: boolean
    className?: string
  }

  const actions: Action[] = []

  if (projectStatus === 'active') {
    actions.push({
      label: 'Mark Complete',
      icon: CheckCircle2,
      onClick: () => updateStatus('completed'),
      loading: loading === 'completed',
      className: 'text-emerald-600',
    })
    actions.push({
      label: 'Archive',
      icon: Archive,
      onClick: () => updateStatus('archived'),
      loading: loading === 'archived',
    })
  } else if (projectStatus === 'completed') {
    actions.push({
      label: 'Reactivate',
      icon: RotateCcw,
      onClick: () => updateStatus('active'),
      loading: loading === 'active',
    })
    actions.push({
      label: 'Archive',
      icon: Archive,
      onClick: () => updateStatus('archived'),
      loading: loading === 'archived',
    })
  } else if (projectStatus === 'archived') {
    actions.push({
      label: 'Reactivate',
      icon: RotateCcw,
      onClick: () => updateStatus('active'),
      loading: loading === 'active',
    })
  }

  if (isParent) {
    actions.push({
      label: 'Delete',
      icon: Trash2,
      onClick: deleteProject,
      loading: loading === 'delete',
      className: 'text-red-500 hover:bg-red-50 hover:text-red-600',
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
        Actions
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-xl bg-white border shadow-lg py-1 overflow-hidden">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={action.onClick}
                disabled={!!action.loading}
                className={`flex items-center gap-2 w-full px-4 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors disabled:opacity-50 ${action.className || ''}`}
              >
                <action.icon className="w-4 h-4" />
                {action.loading ? '...' : action.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
