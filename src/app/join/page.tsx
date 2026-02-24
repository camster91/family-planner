'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Users, ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function JoinFamilyPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [familyInfo, setFamilyInfo] = useState<any>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Check for code in URL
  useEffect(() => {
    const urlCode = searchParams.get('code')
    if (urlCode) {
      setCode(urlCode)
      checkFamilyCode(urlCode)
    }
  }, [searchParams])

  const checkFamilyCode = async (familyCode: string) => {
    try {
      // Extract family ID from code (in MVP, code is FAM-{family_id_slice})
      const familyIdMatch = familyCode.match(/FAM-([A-Z0-9]+)/)
      if (!familyIdMatch) {
        setError('Invalid family code format')
        return
      }

      // In a real app, you would have an invites table
      // For MVP, we'll simulate by checking if family exists
      const { data: family, error: familyError } = await supabase
        .from('families')
        .select('id, name')
        .ilike('id', `%${familyIdMatch[1].toLowerCase()}%`)
        .single()

      if (familyError || !family) {
        setError('Family not found. Please check the code.')
        return
      }

      setFamilyInfo(family)
      setError(null)
    } catch (err) {
      console.error('Error checking family code:', err)
      setError('Failed to validate family code')
    }
  }

  const handleJoinFamily = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      if (!user) {
        // Redirect to login with redirect back to join
        router.push(`/login?redirect=/join?code=${code}`)
        return
      }

      // Check if user already has a family
      const { data: userData } = await supabase
        .from('users')
        .select('family_id')
        .eq('id', user.id)
        .single()

      if (userData?.family_id) {
        setError('You already belong to a family. Leave your current family first.')
        setLoading(false)
        return
      }

      // Extract family ID from code
      const familyIdMatch = code.match(/FAM-([A-Z0-9]+)/)
      if (!familyIdMatch) {
        setError('Invalid family code format')
        setLoading(false)
        return
      }

      // Find family by ID (simplified for MVP)
      const { data: family, error: familyError } = await supabase
        .from('families')
        .select('id, name')
        .ilike('id', `%${familyIdMatch[1].toLowerCase()}%`)
        .single()

      if (familyError || !family) {
        setError('Family not found. Please check the code.')
        setLoading(false)
        return
      }

      // Update user to join family
      const { error: updateError } = await supabase
        .from('users')
        .update({ family_id: family.id })
        .eq('id', user.id)

      if (updateError) {
        setError(updateError.message)
        setLoading(false)
        return
      }

      setSuccess(`Successfully joined ${family.name}!`)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 2000)

    } catch (err) {
      setError('An unexpected error occurred')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleCheckCode = () => {
    if (!code.trim()) {
      setError('Please enter a family code')
      return
    }
    checkFamilyCode(code)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
              <Users className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Join a Family</h1>
          <p className="mt-2 text-gray-600">
            Enter your family code to join an existing family group.
          </p>
        </div>

        <div className="card">
          <form onSubmit={handleJoinFamily} className="space-y-6">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md">
                <div className="flex items-center">
                  <Check className="w-5 h-5 mr-2" />
                  {success}
                </div>
                <p className="mt-2 text-sm text-green-600">
                  Redirecting to dashboard...
                </p>
              </div>
            )}

            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-2">
                Family Code
              </label>
              <div className="flex space-x-4">
                <input
                  id="code"
                  type="text"
                  required
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase())
                    setFamilyInfo(null)
                  }}
                  className="input-field flex-1 font-mono uppercase"
                  placeholder="FAM-ABCD1234"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={handleCheckCode}
                  disabled={loading || !code.trim()}
                  className="btn-secondary whitespace-nowrap"
                >
                  Check Code
                </button>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Get this code from your family admin. It looks like "FAM-ABCD1234".
              </p>
            </div>

            {familyInfo && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center">
                  <Users className="w-5 h-5 text-blue-600 mr-3" />
                  <div>
                    <div className="font-medium text-blue-900">{familyInfo.name}</div>
                    <div className="text-sm text-blue-700">Ready to join!</div>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-4 border-t">
              <button
                type="submit"
                disabled={loading || !code.trim() || !familyInfo}
                className="btn-primary w-full py-3 inline-flex items-center justify-center"
              >
                {loading ? 'Joining...' : 'Join Family'}
                <ArrowRight className="w-5 h-5 ml-2" />
              </button>
            </div>
          </form>

          <div className="mt-6 pt-6 border-t">
            <div className="text-center text-sm text-gray-600">
              <p className="mb-4">Don't have a family code?</p>
              <div className="space-y-3">
                <p>
                  Ask your family admin to send you an invitation or share the family code with you.
                </p>
                <p>
                  Want to create your own family?{' '}
                  <Link href="/dashboard/family/create" className="text-blue-600 hover:text-blue-500 font-medium">
                    Create a new family
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center text-sm text-gray-500">
          <p>By joining a family, you agree to our Terms and Privacy Policy</p>
        </div>
      </div>
    </div>
  )
}