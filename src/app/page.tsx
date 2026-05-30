'use client'

import { Calendar, CheckCircle, MessageSquare, Users, Zap, Gift, ArrowRight, Star, Shield, Wallet, ShoppingCart, FolderKanban } from 'lucide-react'
import Link from 'next/link'
import { useTranslation } from '@/i18n'
import { trackEvent } from '@/lib/analytics'

export default function Home() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-teal-50 via-sky-50 to-purple-50" />
        <div className="relative container mx-auto px-4 py-16 md:py-24">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/80 backdrop-blur rounded-full text-sm font-medium text-teal-600 mb-8 shadow-sm">
              <Zap className="w-4 h-4" />
              Now with Budget, Projects & Shopping Lists
            </div>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold text-gray-900 mb-6 leading-tight">
              {t('landing.heroTitle')}
              <span className="block text-teal-600 mt-2">{t('landing.heroSubtitle')}</span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 max-w-2xl mx-auto mb-10">
              The all-in-one family organizer. Track chores, manage budgets, plan projects, shop together, and stay in sync — all in one calm, ad-free space.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/register"
                onClick={() => trackEvent('cta_click', { location: 'hero_primary', label: 'Start Free' })}
                className="inline-flex items-center justify-center bg-teal-500 text-white text-lg px-8 py-4 rounded-xl font-semibold hover:bg-teal-600 transition-colors shadow-lg shadow-teal-200"
              >
                Start Free — No Credit Card
                <ArrowRight className="w-5 h-5 ml-2" />
              </Link>
              <Link
                href="/login"
                onClick={() => trackEvent('cta_click', { location: 'hero_secondary', label: 'Sign In' })}
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

      {/* Features Grid — All Modules */}
      <section id="features" className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-4">Everything your family needs</h2>
          <p className="text-gray-600 text-center mb-12 max-w-2xl mx-auto">
            One app that replaces chore charts, spreadsheets, shopping lists, and sticky notes.
          </p>

          {/* Row 1: Chores + Gamification */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="card flex gap-5 items-start p-6 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-14 h-14 bg-teal-100 rounded-2xl flex items-center justify-center">
                <CheckCircle className="w-7 h-7 text-teal-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Chore Tracking & Gamification</h3>
                <p className="text-gray-600 text-sm">Assign chores with points and due dates. Kids earn XP, build streaks, and unlock rewards. Photo verification keeps everyone honest.</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-yellow-50 text-yellow-700 rounded-full">XP & Levels</span>
                  <span className="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded-full">Streaks</span>
                  <span className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded-full">Rewards</span>
                  <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded-full">Leaderboard</span>
                </div>
              </div>
            </div>

            <div className="card flex gap-5 items-start p-6 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center">
                <Wallet className="w-7 h-7 text-emerald-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Budget Tracker</h3>
                <p className="text-gray-600 text-sm">Track income and expenses in seconds. Custom categories with icons and colors. See where your money goes with clear charts — no spreadsheets needed.</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">One-tap entry</span>
                  <span className="text-xs px-2 py-1 bg-sky-50 text-sky-700 rounded-full">Charts</span>
                  <span className="text-xs px-2 py-1 bg-violet-50 text-violet-700 rounded-full">Recurring</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Shopping + Calendar */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="card flex gap-5 items-start p-6 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center">
                <ShoppingCart className="w-7 h-7 text-pink-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Shared Shopping Lists</h3>
                <p className="text-gray-600 text-sm">Create shared or private lists that update instantly. Search items, filter by checked, log purchases as expenses, and repeat lists for regular shopping trips.</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-pink-50 text-pink-700 rounded-full">Instant search</span>
                  <span className="text-xs px-2 py-1 bg-rose-50 text-rose-700 rounded-full">Purchase logging</span>
                  <span className="text-xs px-2 py-1 bg-fuchsia-50 text-fuchsia-700 rounded-full">Repeatable</span>
                </div>
              </div>
            </div>

            <div className="card flex gap-5 items-start p-6 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center">
                <Calendar className="w-7 h-7 text-green-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Shared Calendar</h3>
                <p className="text-gray-600 text-sm">See today clearly with Day, Week, and Month views. Combines events and tasks in one focused view. Pull in shopping lists and project tasks for simple daily planning.</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">Day/Week/Month</span>
                  <span className="text-xs px-2 py-1 bg-teal-50 text-teal-700 rounded-full">Tasks + Events</span>
                  <span className="text-xs px-2 py-1 bg-cyan-50 text-cyan-700 rounded-full">Color-coded</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3: Projects + Messages */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card flex gap-5 items-start p-6 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-14 h-14 bg-amber-100 rounded-2xl flex items-center justify-center">
                <FolderKanban className="w-7 h-7 text-amber-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Projects</h3>
                <p className="text-gray-600 text-sm">Keep plans from getting scattered. Group tasks into projects for trips, events, and long-term goals. Track progress and send tasks straight to your calendar.</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded-full">Progress tracking</span>
                  <span className="text-xs px-2 py-1 bg-yellow-50 text-yellow-700 rounded-full">Send to calendar</span>
                  <span className="text-xs px-2 py-1 bg-orange-50 text-orange-700 rounded-full">Archive</span>
                </div>
              </div>
            </div>

            <div className="card flex gap-5 items-start p-6 hover:shadow-md transition-shadow">
              <div className="flex-shrink-0 w-14 h-14 bg-violet-100 rounded-2xl flex items-center justify-center">
                <MessageSquare className="w-7 h-7 text-violet-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold mb-2">Family Chat</h3>
                <p className="text-gray-600 text-sm">Built-in messaging so everyone stays in the loop. Share announcements, coordinate plans, and keep conversations organized without switching apps.</p>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <span className="text-xs px-2 py-1 bg-violet-50 text-violet-700 rounded-full">Read receipts</span>
                  <span className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded-full">Announcements</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16 bg-gradient-to-b from-gray-50 to-white">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">Start in 60 seconds</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            <div className="text-center">
              <div className="w-16 h-16 bg-teal-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-teal-600">1</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Create your family</h3>
              <p className="text-gray-600">Sign up, name your family, and invite members in one click.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-sky-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-sky-600">2</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Set up together</h3>
              <p className="text-gray-600">Add chores, create a budget, start a shopping list, or plan a project.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-purple-600">3</span>
              </div>
              <h3 className="font-semibold text-lg mb-2">Stay organized</h3>
              <p className="text-gray-600">Everything in one place. Less chaos, more calm.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Trust + CTA */}
      <section className="py-16 bg-white">
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
                <span className="text-sm">Any Device</span>
              </div>
            </div>
            <h2 className="text-3xl font-bold mb-4">Ready for calmer, more organized days?</h2>
            <p className="text-gray-600 mb-8">No ads. No data selling. Just calm, reliable tools for everyday family life.</p>
            <Link
              href="/register"
              onClick={() => trackEvent('cta_click', { location: 'bottom_cta', label: 'Get Started' })}
              className="inline-flex items-center justify-center bg-teal-500 text-white text-lg px-10 py-4 rounded-xl font-semibold hover:bg-teal-600 transition-colors shadow-lg shadow-teal-200"
            >
              Get Started Free
              <ArrowRight className="w-5 h-5 ml-2" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 bg-gray-50 border-t">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center">
              <div className="w-8 h-8 bg-teal-500 rounded-xl flex items-center justify-center shadow-sm shadow-teal-200">
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
