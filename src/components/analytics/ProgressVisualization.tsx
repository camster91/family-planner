'use client'

import { useState, useEffect } from 'react'
import { TrendingUp, Users, Award, Target, Calendar, Star, Trophy, Activity } from 'lucide-react'

interface WeeklyData {
  date: string
  day: string
  count: number
  points: number
}

interface MemberParticipation {
  id: string
  name: string
  role: string
  totalChores: number
  completedChores: number
  completionRate: number
  totalPoints: number
}

interface AnalyticsData {
  summary: {
    totalChores: number
    completedChores: number
    completionRate: number
    totalPoints: number
    currentStreak: number
    mostActiveDay: {
      day: string
      count: number
    } | null
  }
  weeklyTrend: WeeklyData[]
  memberParticipation: MemberParticipation[]
  topPerformers: MemberParticipation[]
  difficultyDistribution: {
    easy: number
    medium: number
    hard: number
  }
  recentActivity: Array<{
    id: string
    title: string
    points: number
    completedAt: string
    assignee: string
  }>
}

export default function ProgressVisualization() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAnalytics()
  }, [])

  const fetchAnalytics = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/analytics')
      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch analytics')
      }
      
      setData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics')
      console.error('Error fetching analytics:', err)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading progress data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
        <p>Error loading analytics: {error}</p>
        <button
          onClick={fetchAnalytics}
          className="mt-2 text-sm font-medium text-red-800 hover:text-red-900"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!data) {
    return null
  }

  const maxWeeklyCount = Math.max(...data.weeklyTrend.map(d => d.count), 1)
  const maxWeeklyPoints = Math.max(...data.weeklyTrend.map(d => d.points), 1)

  return (
    <div className="space-y-8">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center mr-4">
              <Target className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Completion Rate</p>
              <p className="text-2xl font-semibold text-gray-900">{data.summary.completionRate}%</p>
            </div>
          </div>
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div 
                className="bg-green-600 h-2 rounded-full transition-all duration-300" 
                style={{ width: `${data.summary.completionRate}%` }}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center mr-4">
              <TrendingUp className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Current Streak</p>
              <p className="text-2xl font-semibold text-gray-900">{data.summary.currentStreak} days</p>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">
            {data.summary.mostActiveDay && (
              <p>Most active: {data.summary.mostActiveDay.day}</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center mr-4">
              <Star className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Total Points</p>
              <p className="text-2xl font-semibold text-gray-900">{data.summary.totalPoints}</p>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">
            <p>{data.summary.completedChores} chores completed</p>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center mr-4">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-600">Family Members</p>
              <p className="text-2xl font-semibold text-gray-900">{data.memberParticipation.length}</p>
            </div>
          </div>
          <div className="mt-2 text-sm text-gray-600">
            <p>{data.topPerformers.length} active performers</p>
          </div>
        </div>
      </div>

      {/* Weekly Trend Chart */}
      <div className="card">
        <div className="flex items-center mb-6">
          <Calendar className="w-5 h-5 text-blue-600 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">Weekly Completion Trend</h3>
        </div>
        
        <div className="space-y-6">
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Chores Completed</h4>
            <div className="flex items-end justify-between h-32">
              {data.weeklyTrend.map((dayData, index) => (
                <div key={index} className="flex flex-col items-center flex-1">
                  <div className="text-xs text-gray-500 mb-2">{dayData.day}</div>
                  <div className="relative flex-1 w-full flex items-end">
                    <div 
                      className="w-3/4 mx-auto bg-blue-500 rounded-t transition-all duration-300 hover:bg-blue-600"
                      style={{ height: `${(dayData.count / maxWeeklyCount) * 90}%` }}
                      title={`${dayData.count} chores on ${dayData.date}`}
                    />
                  </div>
                  <div className="text-xs font-medium mt-1">{dayData.count}</div>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h4 className="text-sm font-medium text-gray-700 mb-4">Points Earned</h4>
            <div className="flex items-end justify-between h-32">
              {data.weeklyTrend.map((dayData, index) => (
                <div key={index} className="flex flex-col items-center flex-1">
                  <div className="text-xs text-gray-500 mb-2">{dayData.day}</div>
                  <div className="relative flex-1 w-full flex items-end">
                    <div 
                      className="w-3/4 mx-auto bg-green-500 rounded-t transition-all duration-300 hover:bg-green-600"
                      style={{ height: `${(dayData.points / maxWeeklyPoints) * 90}%` }}
                      title={`${dayData.points} points on ${dayData.date}`}
                    />
                  </div>
                  <div className="text-xs font-medium mt-1">{dayData.points}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Top Performers */}
      <div className="card">
        <div className="flex items-center mb-6">
          <Trophy className="w-5 h-5 text-yellow-600 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">Top Performers</h3>
        </div>
        
        <div className="space-y-4">
          {data.topPerformers.map((member, index) => (
            <div key={member.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mr-4">
                  <span className="font-semibold text-blue-600">
                    {index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'}
                  </span>
                </div>
                <div>
                  <h4 className="font-medium text-gray-900">{member.name}</h4>
                  <p className="text-sm text-gray-600 capitalize">{member.role}</p>
                </div>
              </div>
              
              <div className="text-right">
                <div className="font-semibold text-gray-900">{member.completedChores} chores</div>
                <div className="text-sm text-gray-600">{member.totalPoints} points</div>
                <div className="text-xs text-green-600 font-medium">
                  {member.completionRate}% completion
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Difficulty Distribution */}
      <div className="card">
        <div className="flex items-center mb-6">
          <Activity className="w-5 h-5 text-purple-600 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">Chore Difficulty Distribution</h3>
        </div>
        
        <div className="space-y-4">
          {Object.entries(data.difficultyDistribution).map(([difficulty, count]) => (
            <div key={difficulty} className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="font-medium text-gray-700 capitalize">{difficulty}</span>
                <span className="text-gray-600">{count} chores</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    difficulty === 'easy' ? 'bg-green-500' :
                    difficulty === 'medium' ? 'bg-yellow-500' :
                    'bg-red-500'
                  }`}
                  style={{ 
                    width: `${(count / data.summary.totalChores) * 100 || 0}%` 
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="flex items-center mb-6">
          <Award className="w-5 h-5 text-green-600 mr-3" />
          <h3 className="text-lg font-semibold text-gray-900">Recent Activity</h3>
        </div>
        
        <div className="space-y-3">
          {data.recentActivity.map((activity) => (
            <div key={activity.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg">
              <div>
                <p className="font-medium text-gray-900">{activity.title}</p>
                <p className="text-sm text-gray-600">
                  Completed by {activity.assignee} • {new Date(activity.completedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center">
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-medium">
                  {activity.points} pts
                </span>
              </div>
            </div>
          ))}
          
          {data.recentActivity.length === 0 && (
            <div className="text-center py-8">
              <Award className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500">No recent activity</p>
              <p className="text-sm text-gray-600 mt-1">Complete some chores to see activity here!</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}