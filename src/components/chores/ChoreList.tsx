'use client'

import { useState } from 'react'
import { CheckCircle, Clock, AlertCircle, User, Edit, Trash2, CheckCheck, Repeat } from 'lucide-react'
import { Chore, BasicUser } from '@/types'
import { formatDate, getChoreStatusColor, timeRemaining, fileToBase64 } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { notificationService } from '@/lib/notifications'

interface ChoreListProps {
  chores: (Chore & {
    assignee: { name: string } | null
    creator: { name: string } | null
  })[]
  familyMembers: BasicUser[]
  currentUserId: string
}

export default function ChoreList({ chores, familyMembers, currentUserId }: ChoreListProps) {
  const [editingChore, setEditingChore] = useState<string | null>(null)
  const [deletingChore, setDeletingChore] = useState<string | null>(null)
  const [photoFiles, setPhotoFiles] = useState<Record<string, File>>({})
  const supabase = createClient()

  const handleCompleteChore = async (choreId: string) => {
    try {
      // Call API route to complete chore (handles recurrence)
      const response = await fetch('/api/chores/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ choreId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to complete chore')
      }

      // Refresh the page
      window.location.reload()
    } catch (error) {
      console.error('Error completing chore:', error)
      alert(error instanceof Error ? error.message : 'Failed to complete chore. Please try again.')
    }
  }

  const handleVerifyChore = async (choreId: string) => {
    try {
      // Call API route to verify chore
      const response = await fetch('/api/chores/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ choreId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to verify chore')
      }

      // Refresh the page
      window.location.reload()
    } catch (error) {
      console.error('Error verifying chore:', error)
      alert(error instanceof Error ? error.message : 'Failed to verify chore. Please try again.')
    }
  }

  const handlePhotoSelect = (choreId: string, file: File) => {
    setPhotoFiles(prev => ({ ...prev, [choreId]: file }))
  }

  const handleCompleteWithPhoto = async (choreId: string) => {
    try {
      const photoFile = photoFiles[choreId]
      let photoUrl = null
      
      if (photoFile) {
        // Convert to base64 for now (in production, upload to storage)
        const base64 = await fileToBase64(photoFile)
        photoUrl = base64
      }

      // Call API route to complete chore with optional photo
      const response = await fetch('/api/chores/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ choreId, photoUrl }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to complete chore')
      }

      // Clear photo for this chore
      setPhotoFiles(prev => {
        const newPhotos = { ...prev }
        delete newPhotos[choreId]
        return newPhotos
      })

      // Refresh the page
      window.location.reload()
    } catch (error) {
      console.error('Error completing chore with photo:', error)
      alert(error instanceof Error ? error.message : 'Failed to complete chore. Please try again.')
    }
  }

  const handleDeleteChore = async (choreId: string) => {
    if (!confirm('Are you sure you want to delete this chore?')) return

    try {
      const { error } = await supabase
        .from('chores')
        .delete()
        .eq('id', choreId)

      if (error) throw error

      // Refresh the page
      window.location.reload()
    } catch (error) {
      console.error('Error deleting chore:', error)
      alert('Failed to delete chore. Please try again.')
    } finally {
      setDeletingChore(null)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
      case 'verified':
        return <CheckCircle className="w-5 h-5 text-green-500" />
      case 'in_progress':
        return <Clock className="w-5 h-5 text-yellow-500" />
      case 'overdue':
        return <AlertCircle className="w-5 h-5 text-red-500" />
      default:
        return <Clock className="w-5 h-5 text-gray-400" />
    }
  }

  return (
    <div className="space-y-4">
      {chores.map((chore) => (
        <div
          key={chore.id}
          className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition"
        >
          <div className="flex items-start space-x-4 mb-4 sm:mb-0">
            <button
              onClick={() => handleCompleteChore(chore.id)}
              className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                chore.status === 'completed' || chore.status === 'verified'
                  ? 'bg-green-500 border-green-500'
                  : 'border-gray-300 hover:border-green-500'
              }`}
              disabled={chore.status === 'completed' || chore.status === 'verified'}
            >
              {(chore.status === 'completed' || chore.status === 'verified') && (
                <CheckCircle className="w-4 h-4 text-white" />
              )}
            </button>
            
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900">{chore.title}</h3>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getChoreStatusColor(chore.status)}`}>
                  {chore.status.replace('_', ' ')}
                </span>
                {chore.points > 0 && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                    {chore.points} pts
                  </span>
                )}
              </div>
              
              {chore.description && (
                <p className="text-sm text-gray-600 mt-1">{chore.description}</p>
              )}
              
              <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-500">
                <div className="flex items-center">
                  <Clock className="w-4 h-4 mr-1" />
                  Due {formatDate(chore.due_date)} ({timeRemaining(chore.due_date)})
                </div>
                
                <div className="flex items-center">
                  <User className="w-4 h-4 mr-1" />
                  {chore.assignee?.name || 'Unassigned'}
                </div>
                
                {chore.difficulty && (
                  <span className="capitalize">
                    Difficulty: {chore.difficulty}
                  </span>
                )}
                
                {chore.frequency && chore.frequency !== 'once' && (
                  <div className="flex items-center">
                    <Repeat className="w-4 h-4 mr-1" />
                    <span className="capitalize">{chore.frequency}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Show edit/delete for parents - in a real app, we would check if user is the creator */}
            {familyMembers.find(m => m.id === currentUserId)?.role === 'parent' && (
              <>
                {chore.status === 'completed' && (
                  <button
                    onClick={() => handleVerifyChore(chore.id)}
                    className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-md"
                    title="Verify chore completion"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setEditingChore(chore.id)}
                  className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                  title="Edit chore"
                >
                  <Edit className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDeleteChore(chore.id)}
                  disabled={deletingChore === chore.id}
                  className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-md"
                  title="Delete chore"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
            {getStatusIcon(chore.status)}
          </div>
        </div>
      ))}
    </div>
  )
}