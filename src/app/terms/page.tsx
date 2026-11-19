import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, type LegalSection } from '@/components/legal/LegalPage'
import { PRODUCT_BRAND } from '@/lib/brand'

const NAME = PRODUCT_BRAND.name

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `${NAME} terms of service.`,
}

const link = 'text-primary underline underline-offset-2'

const sections: LegalSection[] = [
  {
    id: 'what-it-is',
    title: `What ${NAME} is`,
    body: (
      <p>
        {NAME} is a family organizer. You can use it to track chores, share a family calendar, keep shopping and
        other lists, plan projects and run a family budget. It is a hosted service: we run it for you on Cloudflare,
        as described in our{' '}
        <Link href="/privacy#where-it-lives" className={link}>
          Privacy Policy
        </Link>
        . A free tier is available.
      </p>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <ul className="list-disc space-y-2 pl-6">
        <li>Don&apos;t use it for illegal activity.</li>
        <li>Don&apos;t try to break the service or get around its limits.</li>
        <li>You&apos;re responsible for what you and your family members post.</li>
        <li>Don&apos;t use it to harass or harm others.</li>
      </ul>
    ),
  },
  {
    id: 'your-account',
    title: 'Your account',
    body: (
      <p>
        You are responsible for your password and for what happens under your account. Tell us promptly if you
        think someone else has used it. You confirm your email address before you can sign in.
      </p>
    ),
  },
  {
    id: 'ending',
    title: 'Ending your account',
    body: (
      <p>
        You can delete your account at any time in Settings, Privacy &amp; data. If you are the only parent in your
        household, first invite another parent to delete only your own account, or delete the whole household. We may
        suspend accounts that break these terms.
      </p>
    ),
  },
  {
    id: 'no-warranty',
    title: 'No warranty',
    body: (
      <p>
        {NAME} is provided as-is. We work hard to keep it running and your information safe, but we can&apos;t
        promise the service will never be interrupted.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Liability',
    body: (
      <p>
        We&apos;re not liable for any indirect damages from using {NAME}. Our total liability is limited to what
        you&apos;ve paid us (which is currently $0 for the free tier).
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>We may update these terms. We will email you about important changes at least 30 days in advance.</p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions? Email{' '}
        <a href="mailto:support@ashbi.ca" className={link}>
          support@ashbi.ca
        </a>
        .
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalPage
      current="terms"
      title="Terms of Service"
      updated="November 2026"
      summary={[
        <>{NAME} is a hosted family organizer that we run for you on Cloudflare. A free tier is available.</>,
        <>Use it lawfully and kindly. You are responsible for what you and your family post.</>,
        <>Keep your password safe. You can delete your account at any time in Settings.</>,
        <>The service is provided as-is, and our liability is limited.</>,
        <>We will email you at least 30 days before important changes to these terms.</>,
      ]}
      sections={sections}
    />
  )
}
