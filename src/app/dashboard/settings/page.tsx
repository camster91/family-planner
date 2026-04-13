'use client'

import { useState, useEffect } from 'react'
import { Save, Bell, User, Shield, Moon, Globe, X, KeyRound } from 'lucide-react'

export default function SettingsPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [age, setAge] = useState('')
  const [notifications, setNotifications] = useState({
    choreReminders: true,
    eventReminders: true,
    newMessages: true,
    weeklyReports: false,
  })
  const [theme, setTheme] = useState('light')
  const [language, setLanguage] = useState('en')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{type: 'success' | 'error', text: string} | null>(null)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)

  // Load user data
  useEffect(() => {
    loadUserData()
  }, [])

  const loadUserData = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/users')
      const data = await res.json()

      if (res.ok && data.user) {
        setName(data.user.name || '')
        setEmail(data.user.email || '')
        setRole(data.user.role || '')
        setAge(data.user.age?.toString() || '')
      }
    } catch (err) {
      console.error('Error loading user data:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setMessage(null)

    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          age: age ? parseInt(age) : null,
        }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Failed to update profile')

      setMessage({ type: 'success', text: 'Profile updated successfully!' })
    } catch (err) {
      console.error('Error saving profile:', err)
      setMessage({ type: 'error', text: 'Failed to update profile. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  const handleSavePreferences = async () => {
    setSaving(true)
    setMessage(null)

    try {
      // Save preferences to localStorage for now
      localStorage.setItem('familyPlanner_notifications', JSON.stringify(notifications))
      localStorage.setItem('familyPlanner_theme', theme)
      localStorage.setItem('familyPlanner_language', language)

      setMessage({ type: 'success', text: 'Preferences saved successfully!' })
    } catch (err) {
      console.error('Error saving preferences:', err)
      setMessage({ type: 'error', text: 'Failed to save preferences.' })
    } finally {
      setSaving(false)
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)

    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }

    setChangingPassword(true)
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to change password')

      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
      setTimeout(() => {
        setShowPasswordModal(false)
        setPasswordSuccess(false)
      }, 2000)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">
          Manage your account preferences and family settings.
        </p>
      </div>

      {message && (
        <div className={`p-4 rounded-md ${
          message.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
        }`}>
          {message.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Settings */}
        <div className="lg:col-span-2 space-y-8">
          <div className="card">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Profile</h2>
                <p className="text-gray-600">Update your personal information</p>
              </div>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="input-field"
                    placeholder="Your name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="input-field bg-gray-50"
                    placeholder="Your email"
                  />
                  <p className="mt-1 text-xs text-gray-500">Contact support to change email</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Role
                  </label>
                  <input
                    type="text"
                    value={role}
                    disabled
                    className="input-field bg-gray-50 capitalize"
                  />
                  <p className="mt-1 text-xs text-gray-500">Role is set by family admin</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Age (Optional)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    className="input-field"
                    placeholder="Your age"
                  />
                </div>
              </div>

              <div className="flex justify-end pt-4 border-t">
                <button
                  type="submit"
                  disabled={saving}
                  className="btn-primary inline-flex items-center"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
              </div>
            </form>
          </div>

          {/* Notification Settings */}
          <div className="card">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
                <Bell className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Notifications</h2>
                <p className="text-gray-600">Choose what notifications you receive</p>
              </div>
            </div>

            <div className="space-y-4">
              {Object.entries(notifications).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between py-3 border-b last:border-0">
                  <div>
                    <div className="font-medium text-gray-900 capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </div>
                    <div className="text-sm text-gray-600">
                      {key === 'choreReminders' && 'Reminders for assigned chores'}
                      {key === 'eventReminders' && 'Reminders for upcoming events'}
                      {key === 'newMessages' && 'Notifications for new family messages'}
                      {key === 'weeklyReports' && 'Weekly family activity reports'}
                    </div>
                  </div>
                  <button
                    onClick={() => setNotifications(prev => ({
                      ...prev,
                      [key]: !value
                    }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full ${
                      value ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                      value ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-4 border-t mt-6">
              <button
                onClick={handleSavePreferences}
                disabled={saving}
                className="btn-primary inline-flex items-center"
              >
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Saving...' : 'Save Preferences'}
              </button>
            </div>
          </div>
        </div>

        {/* Sidebar - Additional Settings */}
        <div className="space-y-8">
          {/* Theme Settings */}
          <div className="card">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-4">
                <Moon className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Theme</h2>
                <p className="text-gray-600">Choose your preferred theme</p>
              </div>
            </div>

            <div className="space-y-4">
              {['light', 'dark', 'auto'].map((themeOption) => (
                <button
                  key={themeOption}
                  onClick={() => setTheme(themeOption)}
                  className={`w-full p-4 rounded-lg border-2 text-left ${
                    theme === themeOption
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-medium text-gray-900 capitalize">{themeOption}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {themeOption === 'light' && 'Always light mode'}
                    {themeOption === 'dark' && 'Always dark mode'}
                    {themeOption === 'auto' && 'Follow system preference'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Language Settings */}
          <div className="card">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
                <Globe className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Language</h2>
                <p className="text-gray-600">Choose your preferred language</p>
              </div>
            </div>

            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="input-field w-full"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="zh">中文</option>
            </select>
          </div>

          {/* Privacy & Security */}
          <div className="card">
            <div className="flex items-center mb-6">
              <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center mr-4">
                <Shield className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Privacy & Security</h2>
                <p className="text-gray-600">Manage your privacy settings</p>
              </div>
            </div>

            <div className="space-y-4">
              <button
                onClick={() => setShowPasswordModal(true)}
                className="w-full p-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg"
              >
                Change Password
              </button>
              <button className="w-full p-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg">
                Two-Factor Authentication
              </button>
              <button className="w-full p-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg">
                Data Export
              </button>
              <button className="w-full p-3 text-left text-red-600 hover:bg-red-50 rounded-lg">
                Delete Account
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* App Info */}
      <div className="bg-gray-50 rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Family Planner</h3>
            <p className="text-gray-600">Version 1.0.0 • Phase 1 MVP</p>
          </div>
          <div className="mt-4 md:mt-0 text-sm text-gray-500">
            <p>&copy; {new Date().getFullYear()} Family Planner. All rights reserved.</p>
          </div>
        </div>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                  <KeyRound className="w-5 h-5 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold text-gray-900">Change Password</h2>
              </div>
              <button
                onClick={() => { setShowPasswordModal(false); setPasswordError(null); setPasswordSuccess(false) }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {passwordSuccess ? (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <KeyRound className="w-8 h-8 text-green-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">Password Changed</h3>
                <p className="text-gray-600 mt-2">Your password has been updated successfully.</p>
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                {passwordError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                    {passwordError}
                  </div>
                )}
                <div>
                  <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Current Password
                  </label>
                  <input
                    id="currentPassword"
                    type="password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="input-field"
                    autoComplete="current-password"
                  />
                </div>
                <div>
                  <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    New Password
                  </label>
                  <input
                    id="newPassword"
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="input-field"
                    autoComplete="new-password"
                    minLength={8}
                  />
                  <p className="mt-1 text-xs text-gray-500">Must be at least 8 characters</p>
                </div>
                <div>
                  <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-gray-700 mb-2">
                    Confirm New Password
                  </label>
                  <input
                    id="confirmNewPassword"
                    type="password"
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="input-field"
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex space-x-4 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowPasswordModal(false); setPasswordError(null) }}
                    className="btn-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changingPassword || !currentPassword || !newPassword || !confirmNewPassword}
                    className="btn-primary flex-1"
                  >
                    {changingPassword ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
