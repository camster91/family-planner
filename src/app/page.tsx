'use client'

import { Calendar, CheckCircle, MessageSquare, Users, Zap, Award, Gift, ArrowRight, Star, Shield } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'

export default function Home() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50" />
        <div className="relative container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full text-sm font-medium text-indigo-700 mb-8 shadow-sm">
              <Zap className="w-4 h-4" />
              Now with XP, Streaks & Rewards
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight">
              {t('landing.heroTitle')}
              <span className="block text-blue-600 mt-2">{t('landing.heroSubtitle')}</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10">
              Turn chores into a game. Kids earn XP, build streaks, and unlock rewards — while parents stay organized with less nagging.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                className="inline-flex items-center justify-center bg-blue-600 text-white text-lg px-8 py-4 rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
              >
                Start Free — No Credit Card
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center justify-center bg-white text-gray-700 text-lg px-8 py-4 rounded-xl font-semibold hover:bg-gray-50 transition-colors border border-gray-200"
              >
                Sign In
              </Link>
            </div>
            <p className="mt-6 text-sm text-gray-500">
              Free forever for families. No ads. No data selling.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-blue-600">1</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Assign Chores</h3>
              <p className="text-gray-600">Parents create chores with points, difficulty, and due dates.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-green-600">2</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Kids Complete & Earn XP</h3>
              <p className="text-gray-600">Children mark chores done, earn XP, and build daily streaks.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-purple-600">3</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Unlock Rewards</h3>
              <p className="text-gray-600">Spend XP on rewards parents create — extra screen time, treats, outings.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Gamification Showcase */}
      <section className="py-16 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">Make Chores Fun</h2>
          <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
            Gamification that actually works. Kids stay motivated, parents stay sane.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="card text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mb-4">
                <Star className="w-8 h-8 text-yellow-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">XP & Levels</h3>
              <p className="text-gray-600">Earn XP for every verified chore. Level up and show off your progress.</p>
            </div>
            <div className="card text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-orange-100 rounded-full mb-4">
                <Zap className="w-8 h-8 text-orange-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Streaks</h3>
              <p className="text-gray-600">Keep the momentum going. Daily streaks earn bonus XP and bragging rights.</p>
            </div>
            <div className="card text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
                <Gift className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Rewards</h3>
              <p className="text-gray-600">Parents set rewards. Kids claim them with XP. Everyone wins.</p>
            </div>
            <div className="card text-center hover:shadow-lg transition-shadow">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-full mb-4">
                <Award className="w-8 h-8 text-indigo-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">Leaderboard</h3>
              <p className="text-gray-600">Friendly competition. See who is topping the family leaderboard this week.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Everything Your Family Needs</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="card text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                <CheckCircle className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{`Smart Chore Tracking`}</h3>
              <p className="text-gray-600">Assign, track, and verify chores with photo proof and recurring schedules.</p>
            </div>
            <div className="card text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
                <Calendar className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{`Shared Calendar`}</h3>
              <p className="text-gray-600">Never miss a school event, practice, or appointment again.</p>
            </div>
            <div className="card text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mb-4">
                <MessageSquare className="w-8 h-8 text-yellow-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{`Family Chat`}</h3>
              <p className="text-gray-600">Built-in messaging so everyone stays in the loop without extra apps.</p>
            </div>
            <div className="card text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
                <Users className="w-8 h-8 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold mb-3">{`Family Management`}</h3>
              <p className="text-gray-600">Multiple roles for parents, teens, and kids with age-appropriate views.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof / Trust */}
      <section className="py-16 bg-gray-50">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl mx-auto text-center">
            <div className="flex items-center justify-center gap-8 mb-8">
              <div className="flex items-center gap-2 text-gray-600">
                <Shield className="w-5 h-5" />
                <span className="text-sm">Privacy First</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Star className="w-5 h-5" />
                <span className="text-sm">Free Forever</span>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <Zap className="w-5 h-5" />
                <span className="text-sm">Works on Any Device</span>
              </div>
            </div>
            <h2 className="text-3xl font-bold mb-6">Ready to transform your family routine?</h2>
            <Link
              href="/register"
              className="inline-flex items-center justify-center bg-blue-600 text-white text-lg px-10 py-4 rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-white border-t">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Users className="w-5 h-5 text-white" />
              </div>
              <span className="ml-2 font-bold text-gray-900">Family Planner</span>
            </div>
            <div className="flex gap-6 text-sm text-gray-600">
              <Link href="/login" className="hover:text-gray-900">Sign In</Link>
              <Link href="/register" className="hover:text-gray-900">Get Started</Link>
            </div>
            <p className="text-sm text-gray-500">© 2026 Family Planner. Built for families.</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
