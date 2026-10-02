import * as React from 'react'
import Link from 'next/link'
import { LargeHeader } from '@/components/ui/large-header'
import { SUPPORT_EMAIL_PENDING_TEXT, supportEmail } from '@/lib/support'

/**
 * Help (#146): short, plain-English answers for beta families, with links to
 * the real pages. Parents only, like Settings: /dashboard/help is not on the
 * kid allowlist (src/lib/kid-access.ts), because most answers point at
 * parent-only pages. The support address comes from src/lib/support.ts.
 */

const linkClass = 'font-medium text-accent underline underline-offset-2'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="card-apple p-5">
      <h2 id={id} className="text-title-3 text-label-primary mb-3">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed text-label-primary">{children}</div>
    </section>
  )
}

function Item({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-label-primary">{title}</h3>
      <p className="text-label-secondary">{children}</p>
    </div>
  )
}

export default function HelpContent({ supportEmail: configured }: { supportEmail?: string }) {
  const email = supportEmail(configured)

  return (
    <div className="pb-20 max-w-2xl mx-auto">
      <LargeHeader title="Help" subtitle={email ? 'Quick answers for your family. Contact us if you get stuck.' : 'Quick answers for your family.'} className="px-4" />

      <div className="px-4 space-y-6">
        <Section id="help-start" title="Getting started">
          <Item title="Create your household">
            After you sign up and confirm your email, create your household on{' '}
            <Link href="/dashboard/family/create" className={linkClass}>
              Create a household
            </Link>
            . You become its parent.
          </Item>
          <Item title="Invite your family">
            Go to{' '}
            <Link href="/dashboard/family/invite" className={linkClass}>
              Family → Invite
            </Link>
            . Type their email and pick a role: child, teen or parent. They get an email with a link to join.
          </Item>
          <Item title="Join with a family code">
            On the Invite page, open “In person instead” to see your family code. The other person signs in with
            their own account, opens{' '}
            <Link href="/join" className={linkClass}>
              Join a family
            </Link>{' '}
            and types the code. A code always joins them as a child or teen.
          </Item>
        </Section>

        <Section id="help-chores" title="Chores and rewards">
          <Item title="Chores">
            Add a chore on{' '}
            <Link href="/dashboard/chores" className={linkClass}>
              Chores
            </Link>{' '}
            and choose who does it. When it is ticked off, it waits for a parent to check. Verify gives the points
            (XP). Reject sends it back with a short reason, so they can try again.
          </Item>
          <Item title="Rewards">
            Add rewards on{' '}
            <Link href="/dashboard/rewards" className={linkClass}>
              Rewards
            </Link>
            . Each one costs some XP. Kids save up their points and claim them.
          </Item>
        </Section>

        <Section id="help-plan" title="Calendar, meals and lists">
          <Item title="Calendar">
            Add family events on the{' '}
            <Link href="/dashboard/calendar" className={linkClass}>
              Calendar
            </Link>
            . Everyone in the household sees what is coming up.
          </Item>
          <Item title="Meals">
            Plan the week’s dinners on{' '}
            <Link href="/dashboard/meals" className={linkClass}>
              Meals
            </Link>
            .
          </Item>
          <Item title="Lists">
            Keep shared lists, like groceries, on{' '}
            <Link href="/dashboard/lists" className={linkClass}>
              Lists
            </Link>
            . Everyone can add and tick items.
          </Item>
        </Section>

        <Section id="help-account" title="Trouble signing in">
          <Item title="Forgot your password">
            Use{' '}
            <Link href="/forgot-password" className={linkClass}>
              Forgot password
            </Link>{' '}
            to get a reset link by email. The link works for one hour. If you know your password
            and want a new one, use Settings → Privacy &amp; Security → Change Password.
          </Item>
          <Item title="The confirmation email did not arrive">
            Check your spam or junk folder. On the sign-in page you can ask for a new one. The newest link is the one
            that works. Still nothing after a few minutes? Contact us below.
          </Item>
        </Section>

        <Section id="help-data" title="Your data">
          <Item title="Download your data">
            Go to{' '}
            <Link href="/dashboard/settings" className={linkClass}>
              Settings
            </Link>{' '}
            → Privacy &amp; Security → Data Export. Each family member downloads their own copy.
          </Item>
          <Item title="Delete your account or household">
            In Settings → Privacy &amp; Security, choose Delete Account. If you are the only parent, you can delete
            the whole household. With two parents, each parent deletes their own account first, and the last one can
            then delete the household. Deleted data stays in our backups for up to about five weeks, then it is gone.
          </Item>
          <Item title="Privacy">
            Read how we handle your family’s information in our{' '}
            <Link href="/privacy" className={linkClass}>
              Privacy Policy
            </Link>
            .
          </Item>
        </Section>

        <Section id="help-contact" title="Contact support">
          <p className="text-label-secondary">
            Email us and we will reply within one working day.
          </p>
          {email ? (
            <p>
              <a href={`mailto:${email}`} className={linkClass} data-testid="support-email">
                {email}
              </a>
            </p>
          ) : (
            <>
              <p className="font-medium text-label-primary" data-testid="support-email">
                {SUPPORT_EMAIL_PENDING_TEXT}
              </p>
              <p className="text-label-secondary">Until then, contact the person who invited you to the beta.</p>
            </>
          )}
          <p className="text-label-secondary">
            If you ever see another family’s information, stop and tell us straight away. Please do not share
            screenshots of it.
          </p>
        </Section>
      </div>
    </div>
  )
}
