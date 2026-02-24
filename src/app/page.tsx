import { Calendar, CheckCircle, MessageSquare, Users } from 'lucide-react'
import Link from 'next/link'

export default function Home() {
  return (
    <div className="container mx-auto px-4 py-12">
      {/* Hero Section */}
      <section className="text-center mb-16">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          Organize Your Family Life
          <span className="block text-4xl md:text-5xl text-blue-600 mt-2">Together</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-8">
          Family Planner helps busy families coordinate chores, track schedules, 
          communicate effectively, and build responsibility—all in one beautiful app.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link 
            href="/register" 
            className="btn-primary text-lg px-8 py-3 rounded-full"
          >
            Start Free Trial
          </Link>
          <Link 
            href="/login" 
            className="btn-secondary text-lg px-8 py-3 rounded-full"
          >
            Sign In
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-center mb-12">Everything Your Family Needs</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
              <CheckCircle className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Chore Tracking</h3>
            <p className="text-gray-600">
              Assign chores, track completion, and build responsibility with our fun reward system.
            </p>
          </div>

          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
              <Calendar className="w-8 h-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Family Calendar</h3>
            <p className="text-gray-600">
              Coordinate schedules with a shared calendar that works for parents and kids alike.
            </p>
          </div>

          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 rounded-full mb-4">
              <MessageSquare className="w-8 h-8 text-yellow-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Family Communication</h3>
            <p className="text-gray-600">
              Share announcements, send reminders, and stay connected with built-in messaging.
            </p>
          </div>

          <div className="card text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-purple-100 rounded-full mb-4">
              <Users className="w-8 h-8 text-purple-600" />
            </div>
            <h3 className="text-xl font-semibold mb-3">Progress Tracking</h3>
            <p className="text-gray-600">
              Visualize family progress, celebrate achievements, and build positive habits together.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="mb-16">
        <h2 className="text-3xl font-bold text-center mb-12">Simple & Effective</h2>
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col md:flex-row items-center gap-8 mb-12">
            <div className="md:w-1/2">
              <div className="text-5xl font-bold text-blue-600 mb-4">1</div>
              <h3 className="text-2xl font-semibold mb-4">Create Your Family</h3>
              <p className="text-gray-600">
                Set up your family account in minutes. Invite members via email—each gets their own login.
              </p>
            </div>
            <div className="md:w-1/2 bg-gray-100 rounded-2xl p-8">
              <div className="aspect-video bg-gradient-to-br from-blue-200 to-indigo-200 rounded-lg flex items-center justify-center">
                <Users className="w-24 h-24 text-blue-600 opacity-50" />
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row-reverse items-center gap-8 mb-12">
            <div className="md:w-1/2">
              <div className="text-5xl font-bold text-green-600 mb-4">2</div>
              <h3 className="text-2xl font-semibold mb-4">Assign & Track</h3>
              <p className="text-gray-600">
                Create chores and assign them to family members. Kids check off completed tasks for rewards.
              </p>
            </div>
            <div className="md:w-1/2 bg-gray-100 rounded-2xl p-8">
              <div className="aspect-video bg-gradient-to-br from-green-200 to-emerald-200 rounded-lg flex items-center justify-center">
                <CheckCircle className="w-24 h-24 text-green-600 opacity-50" />
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row items-center gap-8">
            <div className="md:w-1/2">
              <div className="text-5xl font-bold text-purple-600 mb-4">3</div>
              <h3 className="text-2xl font-semibold mb-4">Coordinate & Celebrate</h3>
              <p className="text-gray-600">
                Use the shared calendar for events, send messages, and celebrate achievements together.
              </p>
            </div>
            <div className="md:w-1/2 bg-gray-100 rounded-2xl p-8">
              <div className="aspect-video bg-gradient-to-br from-purple-200 to-pink-200 rounded-lg flex items-center justify-center">
                <Calendar className="w-24 h-24 text-purple-600 opacity-50" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="text-center bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl p-12 text-white">
        <h2 className="text-3xl font-bold mb-6">Ready to Transform Your Family Organization?</h2>
        <p className="text-xl mb-8 max-w-2xl mx-auto">
          Join thousands of families who are already staying organized, connected, and motivated.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link 
            href="/register" 
            className="bg-white text-blue-600 hover:bg-gray-100 text-lg font-semibold px-8 py-3 rounded-full transition"
          >
            Start Free 14-Day Trial
          </Link>
          <Link 
            href="/demo" 
            className="bg-transparent border-2 border-white hover:bg-white/10 text-lg font-semibold px-8 py-3 rounded-full transition"
          >
            Watch Demo
          </Link>
        </div>
        <p className="mt-6 text-blue-100">
          No credit card required • Cancel anytime
        </p>
      </section>
    </div>
  )
}