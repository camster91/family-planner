'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Plus, ArrowRight, CheckCircle, Sparkles, UserPlus } from 'lucide-react'

interface OnboardingFlowProps {
  userId: string
}

export default function OnboardingFlow({ userId }: OnboardingFlowProps) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [familyName, setFamilyName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createFamily() {
    if (!familyName.trim()) {
      setError('Please enter a family name')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: familyName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to create family')
        return
      }
      router.refresh()
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Progress */}
      <div className="flex items-center justify-center gap-4 mb-8">
        {[1, 2, 3].map(i => (
          <div key={i} className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${
            i === step ? 'bg-blue-600 text-white' :
            i < step ? 'bg-green-500 text-white' :
            'bg-gray-200 text-gray-500'
          }`}>
            {i < step ? <CheckCircle className="w-5 h-5" /> : i}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto">
            <Sparkles className="w-10 h-10 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Welcome to Family Planner!</h2>
          <p className="text-gray-600 max-w-md mx-auto">
            Let&apos;s get your family set up in 3 simple steps. You&apos;ll be organizing chores and earning XP in minutes.
          </p>
          <button
            onClick={() => setStep(2)}
            className="inline-flex items-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Get Started
            <ArrowRight className="w-5 h-5 ml-2" />
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-6">
          <div className="text-center">
            <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Users className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">Create Your Family</h2>
            <p className="text-gray-600 mt-2">What should we call your family group?</p>
          </div>

          <div className="max-w-md mx-auto space-y-4">
            {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{error}</div>}
            <input
              type="text"
              value={familyName}
              onChange={e => setFamilyName(e.target.value)}
              placeholder="e.g., The Smith Family"
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
              onKeyDown={e => e.key === 'Enter' && createFamily()}
            />
            <button
              onClick={createFamily}
              disabled={loading}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create Family'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="text-center space-y-6">
          <div className="w-20 h-20 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto">
            <UserPlus className="w-10 h-10 text-purple-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">You&apos;re All Set!</h2>
          <p className="text-gray-600 max-w-md mx-auto">
            Your family is created. Now invite members, create your first chore, or explore the dashboard.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="/dashboard/family/invite"
              className="inline-flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
            >
              <UserPlus className="w-5 h-5 mr-2" />
              Invite Family
            </a>
            <a
              href="/dashboard/chores/create"
              className="inline-flex items-center justify-center px-6 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-colors"
            >
              <Plus className="w-5 h-5 mr-2" />
              First Chore
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
