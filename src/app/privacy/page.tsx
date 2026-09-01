import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Family Planner handles your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 py-12 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-sm p-8 md:p-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Privacy Policy
        </h1>
        <p className="text-sm text-gray-500 mb-8">
          Last updated: September 2026
        </p>

        <div className="prose prose-gray max-w-none space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              What we collect
            </h2>
            <p>
              Family Planner stores the account and family information needed to
              provide the service, including names, email addresses, family
              membership, and the chores, events, lists, messages, rewards,
              budgets, meals, health details, locations, notes, and progress
              information that your family chooses to enter. We do not sell
              personal information or use advertising trackers.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              Where your data lives
            </h2>
            <p>
              Your data is stored in a PostgreSQL database hosted on our
              infrastructure. Passwords are hashed with bcrypt (cost factor 12).
              Session cookies are httpOnly, signed JWTs with a 7-day expiry.
              Email verification is required before login, and sensitive account
              actions require authentication and additional confirmation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              Your rights
            </h2>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong>Access and correction</strong>: view and update your
                profile in Settings.
              </li>
              <li>
                <strong>Export</strong>: download a JSON copy of the account and
                family data available to your role.
              </li>
              <li>
                <strong>Delete</strong>: delete your account after confirming
                your current password. The last parent must either transfer
                responsibility or explicitly delete the whole family.
              </li>
              <li>
                <strong>History</strong>: parents can review recorded security
                and administrative changes in Audit History.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              Children&apos;s data (COPPA)
            </h2>
            <p>
              Family Planner is designed for use by families with children.
              Child and teens. A child or teen account can only be registered
              using a parent-controlled family invitation. Parents control the
              family workspace and can request export or deletion. If you
              believe a child joined without appropriate permission, contact us
              so we can investigate and remove the data.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">Email</h2>
            <p>
              We use email for essential account messages such as address
              verification and password recovery. We do not send marketing
              email.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              Backups
            </h2>
            <p>
              We maintain operational backups and regularly rehearse
              restoration. Deleted information may remain in encrypted or
              access-controlled backups until those backups rotate out, and is
              not restored except for disaster recovery.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">
              Contact
            </h2>
            <p>
              For privacy questions or to exercise your rights:{" "}
              <a
                href="mailto:privacy@ashbi.ca"
                className="text-blue-600 hover:underline"
              >
                privacy@ashbi.ca
              </a>
            </p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-gray-200 text-center">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-500 font-medium"
          >
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
