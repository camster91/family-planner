import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Family Planner terms of service.',
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm p-8 md:p-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Terms of Service</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: June 2026</p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">What Family Planner is</h2>
            <p>
              Family Planner is a family organization tool. You can use it to track
              chores, share a family calendar, manage shopping lists, plan projects,
              and run a family budget. It is provided as a hosted service (free tier
              available).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Acceptable use</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>Don&apos;t use it for illegal activity.</li>
              <li>Don&apos;t try to break the service or circumvent rate limits.</li>
              <li>You&apos;re responsible for what you and your family members post.</li>
              <li>Don&apos;t use it to harass or harm others.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Your account</h2>
            <p>
              You are responsible for your password and for activity under your
              account. Let us know promptly if you suspect unauthorized access.
              Email verification is required before login.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Termination</h2>
            <p>
              You can delete your account at any time from Settings. We may suspend
              accounts that violate these terms. If you&apos;re the only parent in your
              family, you&apos;ll need to add another parent (or transfer ownership)
              before deletion.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">No warranty</h2>
            <p>
              Family Planner is provided as-is. We work hard to keep it running and
              your data safe (daily backups, encrypted passwords, secure sessions),
              but we can&apos;t guarantee uninterrupted service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Liability</h2>
            <p>
              We&apos;re not liable for any indirect damages from using Family Planner.
              Our total liability is limited to what you&apos;ve paid us (which is
              currently $0 for the free tier).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Changes</h2>
            <p>
              We may update these terms. Material changes will be announced via
              email at least 30 days in advance.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Contact</h2>
            <p>
              Questions? <a href="mailto:support@ashbi.ca" className="text-blue-600 hover:underline">support@ashbi.ca</a>
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 text-center">
          <Link href="/" className="text-blue-600 hover:underline font-medium">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
