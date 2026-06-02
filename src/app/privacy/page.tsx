import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Family Planner handles your data.',
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm p-8 md:p-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: June 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">What we collect</h2>
            <p>
              Family Planner is a self-hosted family organizer. We store the data you
              enter: your name, email, family member names, the chores/events/lists/
              messages/rewards you create, and your progress (XP, streaks, completed chores).
              That&apos;s it. No analytics sold to third parties, no advertising, no
              tracking pixels.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Where your data lives</h2>
            <p>
              Your data is stored in a PostgreSQL database hosted on our infrastructure.
              Passwords are hashed with bcrypt (cost factor 12). Session cookies are
              httpOnly, signed JWTs with 7-day expiry. Email verification is required
              before login. Rate limiting and CSRF protection are in place on all
              state-changing endpoints.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Your rights</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Access</strong>: GET <code>/api/users</code> returns your profile.</li>
              <li><strong>Export</strong>: GET <code>/api/users/export</code> returns a JSON file with all your data.</li>
              <li><strong>Delete</strong>: DELETE <code>/api/users</code> removes your account and all associated data (GDPR Article 17).</li>
              <li><strong>Rectify</strong>: PATCH <code>/api/users</code> to update your name/age.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Children&apos;s data (COPPA)</h2>
            <p>
              Family Planner is designed for use by families with children. Child
              accounts (under 13) must be created by a parent. We do not knowingly
              collect data from children directly. If you believe a child account was
              created without parental consent, contact us to remove it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Email</h2>
            <p>
              We send transactional emails only: email verification, password reset,
              chore completion notifications to parents. No marketing email, ever.
              You can opt out of notification emails in Settings.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Backups</h2>
            <p>
              Database is backed up daily. Backups are retained for 14 days (rolling)
              plus 4 weekly snapshots. Backups are integrity-tested on every run.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Contact</h2>
            <p>
              For privacy questions or to exercise your rights: <a href="mailto:privacy@ashbi.ca" className="text-blue-600 hover:underline">privacy@ashbi.ca</a>
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 text-center">
          <Link href="/" className="text-blue-600 hover:text-blue-500 font-medium">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
