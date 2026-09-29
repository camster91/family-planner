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
        <p className="text-sm text-gray-500 mb-8">Last updated: September 2026</p>

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
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Food inventory</h2>
            <p>
              If your family turns on the food inventory, we store the items you add (name, amount,
              where it is kept, category, best-before or use-by date, and when it was bought or
              opened) and a short history of what was used up or thrown away, with who did it and
              when, so it can be undone. Every member of the household can see it, and it is part
              of every member&apos;s data export. It is deleted with the household; removing an item
              also removes its history.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Fridge photo scan</h2>
            <p>
              If the fridge photo scan is turned on, a parent can photograph the fridge,
              freezer or pantry to get suggested food items. That photo is sent to our AI
              provider, Anthropic, only to read it, and is not saved by Family Planner. You
              review the suggestions and choose what to add. The feature is off unless it
              has been set up, and you can always add items by hand instead.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Weather on the Today board (optional)</h2>
            <p>
              Weather is off unless a parent turns it on in Family settings. When it is on, our server
              sends the place the parent chose, as an approximate location rounded to about 1 km, to
              Open-Meteo (open-meteo.com) to get the forecast, and sends the place name a parent types
              when searching for a town. No names, accounts or other household information are sent.
              Turning weather off or removing the place stops these requests and deletes the cached
              forecast.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Family photos on the fridge board (optional)</h2>
            <p>
              A parent can choose photos your household has already uploaded to show on the calm screen
              of the fridge board when it is left alone. They are shown only to signed-in members of your
              household, never on a paired shared tablet, and never sent to anyone else. No photos are
              chosen unless a parent picks them, and the calm screen never shows ads.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Household change history</h2>
            <p>
              When someone changes household settings (turns a feature on or off, sends or cancels an
              invite, joins the household or deletes their account, changes the Today board, or pairs, renames or removes a family
              tablet), we record a short line saying what changed, who did it and when. It holds names
              (of a feature, a member or a tablet) but never email addresses, codes, places or messages.
              Only parents can see it, under Settings, Recent changes. It is kept for 12 months and then
              deleted, and it is deleted with the household. It is part of a parent&apos;s data export;
              a teen&apos;s or child&apos;s export has only the lines about their own changes.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Your rights</h2>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Access</strong>: GET <code>/api/users</code> returns your profile.</li>
              <li><strong>Export</strong>: Settings → Data Export (GET <code>/api/users/export</code>) downloads a JSON file with all your data.</li>
              <li>
                <strong>Delete your account</strong>: Settings → Delete Account. You confirm with your password. Your
                account, sign-ins, messages, notifications and your own chores are deleted; things you added for the
                household (events, lists, meals, notes, photos you uploaded) stay with the household under another parent.
              </li>
              <li>
                <strong>Delete the household</strong>: the only parent can delete the whole household from the same
                place. Every member account, all household data, uploaded photos, paired tablets, invitations and
                calendar connections are deleted, and old links (calendar feed, sitter share link) stop working.
                Short-lived security counters (rate limits) expire on their own. Database backups, where kept,
                still hold deleted data until they are rotated out (up to about five weeks).
              </li>
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
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Importing events from text, photos or PDFs</h2>
            <p>
              If event import is turned on, a parent can paste the text of a school email or
              flyer, or choose a photo or PDF of it, to get suggested calendar events. That
              text or file is sent to our AI provider, Anthropic, only to read it, and is not
              saved by Family Planner. Nothing is added to your calendar until you review the
              suggestions and choose what to add, and you can undo an import for a few minutes
              afterwards. The feature is off unless it has been set up, and you can always add
              events by hand instead.
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
