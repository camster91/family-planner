'use client'

import { useState, useEffect } from 'react'
import { Settings, Bell, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react'
import { eventReminderService } from '@/lib/eventReminders'

export default function AdminControls() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)

  // Check if user is admin (parent role)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    checkUserRole()
  }, [])

  const checkUserRole = async () => {
    try {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      if (res.ok && data.user?.role === 'parent') {
        setIsAdmin(true)
      }
    } catch (err) {
      console.error('Error checking user role:', err)
    }
  }

  const handleTestReminders = async () => {
    setLoading(true)
    setMessage(null)

    try {
      await eventReminderService.checkAndSendReminders()
      setMessage({ type: 'success', text: 'Reminder check completed!' })
    } catch (err) {
      console.error('Error testing reminders:', err)
      setMessage({ type: 'error', text: 'Failed to test reminders' })
    } finally {
      setLoading(false)
    }
  }

  const handleTestOverdueChores = async () => {
    setLoading(true)
    setMessage(null)

    try {
      await eventReminderService.checkOverdueChores()
      setMessage({ type: 'success', text: 'Overdue chore check completed!' })
    } catch (err) {
      console.error('Error testing overdue chores:', err)
      setMessage({ type: 'error', text: 'Failed to test overdue chores' })
    } finally {
      setLoading(false)
    }
  }

  const handleClearNotifications = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearAll: true }),
      })

      if (!res.ok) throw new Error('Failed to clear notifications')

      setMessage({ type: 'success', text: 'Notifications cleared! Refresh the page to see updated counts.' })
    } catch (err) {
      console.error('Error clearing notifications:', err)
      setMessage({ type: 'error', text: 'Failed to clear notifications' })
    } finally {
      setLoading(false)
    }
  }

  if (!isAdmin) {
    return null
  }

  return (
    <div className="mt-8 border-t pt-8">
      <div className="flex items-center mb-6">
        <Settings className="w-5 h-5 text-gray-600 mr-3" />
        <h3 className="text-lg font-semibold text-gray-900">Admin Controls</h3>
        <span className="ml-3 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
          Parent Only
        </span>
      </div>

      {message && (
        <div className={`mb-6 p-4 rounded-md ${
          message.type === 'success'
            ? 'bg-green-50 text-green-800 border border-green-200'
            : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          <div className="flex items-center">
            {message.type === 'success' ? (
              <CheckCircle className="w-5 h-5 mr-3" />
            ) : (
              <AlertTriangle className="w-5 h-5 mr-3" />
            )}
            {message.text}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={handleTestReminders}
          disabled={loading}
          className="p-4 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-left transition"
        >
          <div className="flex items-center mb-2">
            <Bell className="w-5 h-5 text-blue-600 mr-3" />
            <div className="font-medium text-gray-900">Test Reminders</div>
          </div>
          <p className="text-sm text-gray-600">
            Check for upcoming events and send reminder notifications
          </p>
          {loading && (
            <div className="mt-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            </div>
          )}
        </button>

        <button
          onClick={handleTestOverdueChores}
          disabled={loading}
          className="p-4 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-lg text-left transition"
        >
          <div className="flex items-center mb-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600 mr-3" />
            <div className="font-medium text-gray-900">Check Overdue</div>
          </div>
          <p className="text-sm text-gray-600">
            Check for overdue chores and send notifications
          </p>
          {loading && (
            <div className="mt-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600"></div>
            </div>
          )}
        </button>

        <button
          onClick={handleClearNotifications}
          disabled={loading}
          className="p-4 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-left transition"
        >
          <div className="flex items-center mb-2">
            <RefreshCw className="w-5 h-5 text-red-600 mr-3" />
            <div className="font-medium text-gray-900">Clear Notifications</div>
          </div>
          <p className="text-sm text-gray-600">
            Clear all your notifications (testing purposes)
          </p>
          {loading && (
            <div className="mt-3">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600"></div>
            </div>
          )}
        </button>
      </div>

      <div className="mt-6 text-sm text-gray-500">
        <p>
          💡 <strong>Note:</strong> These controls are for testing purposes only.
          In production, reminders would be sent automatically.
        </p>
      </div>
    </div>
  )
}
