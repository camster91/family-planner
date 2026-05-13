'use client'

import { useState, useCallback } from 'react'
import { CheckCircle, Clock, AlertCircle, User, Trash2, CheckCheck, Repeat, Flame, Sparkles, Pencil, Camera, Image as ImageIcon, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Chore, BasicUser } from '@/types'
import { formatDate, getChoreStatusColor, timeRemaining } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import { getBadgeById } from '@/lib/gamification'

interface ChoreListProps {
  chores: (Chore & {
    assignee: { name: string } | null
    creator: { name: string } | null
  })[]
  familyMembers: BasicUser[]
  currentUserId: string
  onChoreUpdated?: () => void
}

export default function ChoreList({ chores, familyMembers, currentUserId, onChoreUpdated }: ChoreListProps) {
  const [localChores, setLocalChores] = useState(chores)
  const [loadingChore, setLoadingChore] = useState<string | null>(null)
  const [photoChoreId, setPhotoChoreId] = useState<string | null>(null)
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null)
  const { addToast } = useToast()
  const router = useRouter()

  if (chores !== localChores && !loadingChore) {
    setLocalChores(chores)
  }

  const handleCompleteChore = useCallback(async (choreId: string, photoUrl?: string) => {
    setLoadingChore(choreId)
    try {
      const res = await fetch('/api/chores/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId, photoUrl }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to complete chore')

      setLocalChores(prev => prev.map(c =>
        c.id === choreId
          ? { ...c, status: 'completed' as const, completed_at: new Date().toISOString(), photo_url: photoUrl || c.photo_url }
          : c
      ))

      const g = data.gamification
      if (g) {
        addToast({ type: 'success', title: 'Chore Completed!', message: `+${g.pointsEarned} points, +${g.xpEarned} XP${g.multiplier > 1 ? ` (${g.multiplier}x streak!)` : ''}` })
        if (g.leveledUp) {
          setTimeout(() => addToast({ type: 'levelup', title: `Level Up! Level ${g.level}`, message: 'Keep up the amazing work!', duration: 5000 }), 1000)
        }
        if (g.streak > 1 && g.streak % 3 === 0) {
          setTimeout(() => addToast({ type: 'streak', title: `${g.streak}-Day Streak!`, message: `You're on fire! ${g.multiplier}x bonus active`, duration: 4000 }), g.leveledUp ? 2500 : 1500)
        }
        if (g.newBadges?.length) {
          g.newBadges.forEach((badgeId: string, i: number) => {
            const badge = getBadgeById(badgeId)
            if (badge) {
              setTimeout(() => addToast({ type: 'achievement', title: `Badge Earned: ${badge.icon} ${badge.name}`, message: badge.description, duration: 5000 }), 2000 + i * 1500)
            }
          })
        }
      }

      setPhotoChoreId(null)
      setPreviewPhoto(null)
      onChoreUpdated?.()
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to complete chore', message: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setLoadingChore(null)
    }
  }, [addToast, onChoreUpdated])

  const handleUploadPhoto = useCallback(async (choreId: string) => {
    if (!previewPhoto) return
    setLoadingChore(choreId)
    try {
      const res = await fetch(`/api/chores/${choreId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photoUrl: previewPhoto }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to upload photo')

      setLocalChores(prev => prev.map(c =>
        c.id === choreId ? { ...c, status: 'completed' as const, completed_at: new Date().toISOString(), photo_url: previewPhoto } : c
      ))

      addToast({ type: 'success', title: 'Photo Submitted!', message: 'Your parent will review the photo proof.' })
      setPhotoChoreId(null)
      setPreviewPhoto(null)
      onChoreUpdated?.()
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to upload photo', message: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setLoadingChore(null)
    }
  }, [addToast, onChoreUpdated, previewPhoto])

  const handleReviewPhoto = useCallback(async (choreId: string, approved: boolean, notes?: string) => {
    setLoadingChore(choreId)
    try {
      const res = await fetch(`/api/chores/${choreId}/photo`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, notes }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to review photo')

      const newStatus = approved ? 'verified' : 'pending'
      setLocalChores(prev => prev.map(c =>
        c.id === choreId ? { ...c, status: newStatus, photo_verified: approved, verified_notes: notes || undefined } : c
      ))

      addToast({
        type: approved ? 'success' : 'error',
        title: approved ? 'Chore Verified!' : 'Photo Rejected',
        message: approved ? 'Great parenting!' : 'Photo rejected — sent back to pending.',
      })
      onChoreUpdated?.()
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to review photo', message: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setLoadingChore(null)
    }
  }, [addToast, onChoreUpdated])

  const handleVerifyChore = useCallback(async (choreId: string) => {
    setLoadingChore(choreId)
    try {
      const res = await fetch('/api/chores/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choreId }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to verify chore')

      setLocalChores(prev => prev.map(c =>
        c.id === choreId ? { ...c, status: 'verified' as const, verified_at: new Date().toISOString() } : c
      ))

      addToast({ type: 'success', title: 'Chore Verified!', message: 'Great parenting!' })
      onChoreUpdated?.()
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to verify chore', message: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setLoadingChore(null)
    }
  }, [addToast, onChoreUpdated])

  const handleDeleteChore = useCallback(async (choreId: string) => {
    if (!confirm('Are you sure you want to delete this chore?')) return
    setLoadingChore(choreId)
    try {
      const res = await fetch(`/api/chores/${choreId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to delete chore')
      setLocalChores(prev => prev.filter(c => c.id !== choreId))
      addToast({ type: 'success', title: 'Chore deleted' })
      onChoreUpdated?.()
    } catch (error) {
      addToast({ type: 'error', title: 'Failed to delete chore', message: error instanceof Error ? error.message : 'Please try again.' })
    } finally {
      setLoadingChore(null)
    }
  }, [addToast, onChoreUpdated])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, choreId: string) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.size > 2 * 1024 * 1024) {
      addToast({ type: 'error', title: 'File too large', message: 'Max 2MB. Try compressing the image.' })
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      setPreviewPhoto(ev.target?.result as string)
      setPhotoChoreId(choreId)
    }
    reader.readAsDataURL(file)
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'verified': return <Sparkles className="w-5 h-5 text-amber-500" />
      case 'in_progress': return <Clock className="w-5 h-5 text-yellow-500" />
      case 'overdue': return <AlertCircle className="w-5 h-5 text-red-500" />
      default: return <Clock className="w-5 h-5 text-gray-400" />
    }
  }

  const currentUserRole = familyMembers.find(m => m.id === currentUserId)?.role

  if (localChores.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-xl">
        <Sparkles className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No chores yet</h3>
        <p className="text-gray-600">Create a chore to get started!</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {localChores.map((chore) => {
        const isLoading = loadingChore === chore.id
        const isDone = chore.status === 'completed' || chore.status === 'verified'
        const isPhotoPending = chore.status === 'completed' && chore.photo_url && !chore.photo_verified
        const showPhotoInput = photoChoreId === chore.id && !isDone
        const isAssignee = chore.assigned_to === currentUserId
        const isParent = currentUserRole === 'parent'

        return (
          <div
            key={chore.id}
            className={`flex flex-col p-4 rounded-lg transition-all duration-200 ${
              isDone
                ? 'bg-green-50 border border-green-100'
                : chore.status === 'overdue'
                ? 'bg-red-50 border border-red-100'
                : 'bg-white border border-gray-100 hover:border-blue-200 hover:shadow-sm'
            } ${isLoading ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start space-x-4 mb-3">
              <button
                onClick={() => {
                  if (!isDone && isAssignee) {
                    setPhotoChoreId(chore.id)
                  }
                }}
                className={`flex-shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-all ${
                  isDone
                    ? 'bg-green-500 border-green-500 cursor-default'
                    : isAssignee
                    ? 'border-gray-300 hover:border-green-500 hover:bg-green-50 cursor-pointer'
                    : 'border-gray-200 cursor-default'
                }`}
                disabled={isDone || !isAssignee}
                aria-label={isDone ? 'Chore completed' : 'Complete chore'}
              >
                {isDone && <CheckCircle className="w-4 h-4 text-white" />}
              </button>

              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={`font-medium ${isDone ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                    {chore.title}
                  </h3>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getChoreStatusColor(chore.status)}`}>
                    {chore.status.replace('_', ' ')}
                  </span>
                  {chore.points > 0 && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full text-xs font-bold">+{chore.points} pts</span>
                  )}
                  {chore.difficulty === 'hard' && (
                    <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium">Hard</span>
                  )}
                </div>

                {chore.description && (
                  <p className="text-sm text-gray-500 mt-1">{chore.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-gray-500">
                  <div className="flex items-center">
                    <Clock className="w-3.5 h-3.5 mr-1" />
                    {formatDate(chore.due_date)} ({timeRemaining(chore.due_date)})
                  </div>
                  <div className="flex items-center">
                    <User className="w-3.5 h-3.5 mr-1" />
                    {chore.assignee?.name || 'Unassigned'}
                  </div>
                  {chore.frequency && chore.frequency !== 'once' && (
                    <div className="flex items-center text-purple-600">
                      <Repeat className="w-3.5 h-3.5 mr-1" />
                      <span className="capitalize">{chore.frequency}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Photo proof section */}
            {isPhotoPending && chore.photo_url && (
              <div className="ml-11 mb-3">
                <div className="relative rounded-lg overflow-hidden border border-gray-200 max-w-sm">
                  <img src={chore.photo_url} alt="Chore proof" className="w-full h-40 object-cover" />
                  {isParent && (
                    <div className="flex items-center gap-2 p-2 bg-white border-t">
                      <button
                        onClick={() => handleReviewPhoto(chore.id, true)}
                        disabled={isLoading}
                        className="flex-1 btn-primary text-xs py-1.5"
                      >
                        <CheckCheck className="w-3.5 h-3.5 inline mr-1" /> Approve
                      </button>
                      <button
                        onClick={() => handleReviewPhoto(chore.id, false)}
                        disabled={isLoading}
                        className="flex-1 btn-secondary text-xs py-1.5"
                      >
                        <XCircle className="w-3.5 h-3.5 inline mr-1" /> Reject
                      </button>
                    </div>
                  )}
                  {!isParent && (
                    <div className="p-2 bg-yellow-50 text-yellow-800 text-xs text-center">
                      Photo submitted — waiting for parent approval
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Photo upload input */}
            {showPhotoInput && (
              <div className="ml-11 mb-3">
                {previewPhoto ? (
                  <div className="space-y-2 max-w-sm">
                    <div className="relative rounded-lg overflow-hidden border border-gray-200">
                      <img src={previewPhoto} alt="Preview" className="w-full h-40 object-cover" />
                      <button
                        onClick={() => { setPreviewPhoto(null); setPhotoChoreId(null); }}
                        className="absolute top-2 right-2 p-1 bg-white/90 rounded-full hover:bg-white"
                      >
                        <XCircle className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleUploadPhoto(chore.id)}
                        disabled={isLoading}
                        className="flex-1 btn-primary text-sm"
                      >
                        Submit Photo & Complete
                      </button>
                      <button
                        onClick={() => handleCompleteChore(chore.id)}
                        disabled={isLoading}
                        className="flex-1 btn-secondary text-sm"
                      >
                        Skip Photo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-700 transition-colors">
                      <Camera className="w-4 h-4" />
                      Take / Upload Photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => handleFileChange(e, chore.id)}
                      />
                    </label>
                    <button
                      onClick={() => handleCompleteChore(chore.id)}
                      disabled={isLoading}
                      className="px-4 py-2 text-sm text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                    >
                      Complete Without Photo
                    </button>
                    <button
                      onClick={() => setPhotoChoreId(null)}
                      className="p-2 text-gray-400 hover:text-gray-600"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-end gap-1 ml-11">
              {(isParent || isAssignee) && (
                <button
                  onClick={() => router.push(`/dashboard/chores/edit?id=${chore.id}`)}
                  className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                  title="Edit chore"
                  aria-label="Edit chore"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )}
              {isParent && (
                <>
                  {chore.status === 'completed' && !chore.photo_url && (
                    <button
                      onClick={() => handleVerifyChore(chore.id)}
                      disabled={isLoading}
                      className="p-2 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                      title="Verify chore"
                      aria-label="Verify chore completion"
                    >
                      <CheckCheck className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteChore(chore.id)}
                    disabled={isLoading}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete chore"
                    aria-label="Delete chore"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
              {getStatusIcon(chore.status)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
