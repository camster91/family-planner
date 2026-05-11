'use client'

import { useState, useEffect } from 'react'
import { useTranslation } from '@/i18n'

interface Member {
  id: string
  name: string
  role: string
  completedChores: number
}

interface LeaderboardProps {
  currentUserId: string
}

export default function Leaderboard({ currentUserId }: LeaderboardProps) {
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const { t } = useTranslation()

  useEffect(() => {
    fetch('/api/family/members')
      .then(res => res.json())
      .then(data => {
        if (data.members) {
          setMembers(data.members.sort((a: Member, b: Member) => b.completedChores - a.completedChores))
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="animate-pulse space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-12 bg-gray-100 rounded" />)}</div>
  }

  if (!members.length) {
    return <p className="text-gray-500 text-sm">{t('dashboard.noFamilyMembers')}</p>
  }

  return (
    <div className="space-y-2">
      {members.map((member, i) => (
        <div key={member.id} className={`flex items-center justify-between p-3 rounded-lg ${member.id === currentUserId ? 'bg-blue-50' : 'bg-gray-50'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${i === 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
              {i + 1}
            </div>
            <div>
              <p className="font-medium text-gray-900">{member.name}</p>
              <p className="text-xs text-gray-500 capitalize">{member.role}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-semibold text-gray-900">{member.completedChores}</p>
            <p className="text-xs text-gray-500">chores</p>
          </div>
        </div>
      ))}
    </div>
  )
}