import * as React from 'react'
import Link from 'next/link'
import { LargeHeader } from '@/components/ui/large-header'
import { BrandIllustration } from '@/components/ui/brand-illustration'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { SUPPORT_EMAIL_PENDING_TEXT, supportEmail } from '@/lib/support'
import { canRoleAccessPath } from '@/lib/kid-access'

/**
 * Help (#146): short, plain-English answers for beta families, with links to
 * the real pages. Parents and teens (O-37) open it; children do not
 * (src/lib/kid-access.ts). The text is the same for everyone and may describe
 * what a parent does, but a page the viewer's role cannot open is named as
 * plain text, not linked, so a teen is never sent somewhere that bounces them
 * home. The support address comes from src/lib/support.ts.
 */

const linkClass = 'font-medium text-accent underline underline-offset-2'

/** A link to `href`, or just its text when `role` may not open that page. */
function PageLink({ href, role, children }: { href: string; role?: string | null; children: React.ReactNode }) {
  // Only dashboard pages are role-gated; /join, /forgot-password and /privacy are open to everyone.
  if (href.startsWith('/dashboard') && !canRoleAccessPath(role, href)) return <span className="font-medium text-label-primary">{children}</span>
  return (
    <Link href={href} className={linkClass}>
      {children}
    </Link>
  )
}

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

export default function HelpContent({
  supportEmail: configured,
  role,
}: {
  supportEmail?: string
  /** The viewer's role; links to pages it cannot open become plain text. */
  role?: string | null
}) {
  const email = supportEmail(configured)

  return (
    <div className="pb-20 max-w-2xl mx-auto">
      <LargeHeader
        title="Help"
        subtitle={email ? 'Quick answers for your family. Contact us if you get stuck.' : 'Quick answers for your family.'}
        trailing={<BrandIllustration source={ILLUSTRATIONS.help} priority className="h-24 w-auto shrink-0 md:h-28" />}
        className="px-4"
      />

      <div className="px-4 space-y-6">
        <Section id="help-start" title="Getting started">
          <Item title="Create your household">
            After you sign up and confirm your email, create your household on{' '}
            <PageLink href="/dashboard/family/create" role={role}>
              Create a household
            </PageLink>
            . You become its parent.
          </Item>
          <Item title="Invite your family">
            Go to{' '}
            <PageLink href="/dashboard/family/invite" role={role}>
              Family → Invite
            </PageLink>
            . Type their email and pick a role: child, teen or parent. They get an email with a link to join.
          </Item>
          <Item title="Join with a family code">
            On the Invite page, open “In person instead” to see your family code. The other person signs in with
            their own account, opens{' '}
            <PageLink href="/join" role={role}>
              Join a family
            </PageLink>{' '}
            and types the code. A code always joins them as a child or teen.
          </Item>
        </Section>

        <Section id="help-chores" title="Chores and rewards">
          <Item title="Chores">
            Add a chore on{' '}
            <PageLink href="/dashboard/chores" role={role}>
              Chores
            </PageLink>{' '}
            and choose who does it. When it is ticked off, it waits for a parent to check. Verify gives the points
            (XP). Reject sends it back with a short reason, so they can try again.
          </Item>
          <Item title="Rewards">
            Add rewards on{' '}
            <PageLink href="/dashboard/rewards" role={role}>
              Rewards
            </PageLink>
            . Each one costs some XP. Kids save up their points and claim them.
          </Item>
        </Section>

        <Section id="help-plan" title="Calendar, meals and lists">
          <Item title="Calendar">
            Add family events on the{' '}
            <PageLink href="/dashboard/calendar" role={role}>
              Calendar
            </PageLink>
            . Everyone in the household sees what is coming up.
          </Item>
          <Item title="Meals">
            Plan the week’s dinners on{' '}
            <PageLink href="/dashboard/meals" role={role}>
              Meals
            </PageLink>
            .
          </Item>
          <Item title="Lists">
            Keep shared lists, like groceries, on{' '}
            <PageLink href="/dashboard/lists" role={role}>
              Lists
            </PageLink>
            . Everyone can add and tick items.
          </Item>
        </Section>

        <Section id="help-account" title="Trouble signing in">
          <Item title="Forgot your password">
            Use{' '}
            <PageLink href="/forgot-password" role={role}>
              Forgot password
            </PageLink>{' '}
            to get a reset link by email. The link works for one hour. If you know your password
            and want a new one, use Settings → Your account → Change Password.
          </Item>
          <Item title="The confirmation email did not arrive">
            Check your spam or junk folder. On the sign-in page you can ask for a new one. The newest link is the one
            that works. Still nothing after a few minutes? Contact us below.
          </Item>
        </Section>

        <Section id="help-data" title="Your data">
          <Item title="Download your data">
            Go to{' '}
            <PageLink href="/dashboard/settings" role={role}>
              Settings
            </PageLink>{' '}
            → Privacy &amp; data → Data Export. Each family member downloads their own copy.
          </Item>
          <Item title="Delete your account or household">
            In Settings → Privacy &amp; data, choose Delete Account. If you are the only parent, you can delete
            the whole household. With two parents, each parent deletes their own account first, and the last one can
            then delete the household. Deleted data stays in our backups for up to about five weeks, then it is gone.
          </Item>
          <Item title="Privacy">
            Read how we handle your family’s information in our{' '}
            <PageLink href="/privacy" role={role}>
              Privacy Policy
            </PageLink>
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
