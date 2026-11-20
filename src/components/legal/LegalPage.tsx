import * as React from 'react'
import Link from 'next/link'
import { BrandMark } from '@/components/ui/brand-illustration'
import { PRODUCT_BRAND } from '@/lib/brand'

export type LegalSection = {
  id: string
  title: string
  body: React.ReactNode
}

/**
 * Shared frame for the privacy policy and terms: site navigation, a short
 * plain-language summary, a table of contents and one `<main>` landmark.
 */
export function LegalPage({
  title,
  updated,
  summary,
  sections,
  current,
}: {
  title: string
  updated: string
  summary: React.ReactNode[]
  sections: LegalSection[]
  current: 'privacy' | 'terms'
}) {
  const navLink =
    'inline-flex min-h-[44px] items-center rounded-lg px-3 text-subhead font-medium text-label-primary hover:bg-[var(--surface-fill-secondary)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]'
  return (
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="marketing-skip">
        Skip to content
      </a>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/" aria-label={PRODUCT_BRAND.homeLabel} className="brand-wordmark min-h-[44px]">
            <BrandMark size={40} className="h-10 w-10" />
            <span>{PRODUCT_BRAND.wordmark}</span>
          </Link>
          <nav aria-label="Site">
            <ul className="flex flex-wrap items-center gap-1">
              <li>
                <Link href="/" className={navLink}>
                  Home
                </Link>
              </li>
              <li>
                {current === 'privacy' ? (
                  <Link href="/terms" className={navLink}>
                    Terms of Service
                  </Link>
                ) : (
                  <Link href="/privacy" className={navLink}>
                    Privacy Policy
                  </Link>
                )}
              </li>
              <li>
                <Link href="/login" className={navLink}>
                  Sign in
                </Link>
              </li>
            </ul>
          </nav>
        </div>
      </header>

      <main id="main-content" className="px-4 py-10">
        <article className="mx-auto max-w-3xl rounded-2xl bg-card p-6 shadow-sm md:p-12">
          <h1 className="mb-2 text-3xl font-bold text-foreground">{title}</h1>
          <p className="mb-8 text-sm text-label-secondary">Last updated: {updated}</p>

          <section aria-labelledby="legal-summary" className="mb-8 rounded-xl bg-[var(--surface-fill-secondary)] p-5">
            <h2 id="legal-summary" className="mb-3 text-xl font-semibold text-foreground">
              The short version
            </h2>
            <ul className="list-disc space-y-2 pl-6 text-foreground">
              {summary.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </section>

          <nav aria-labelledby="legal-contents" className="mb-10">
            <h2 id="legal-contents" className="mb-2 text-xl font-semibold text-foreground">
              On this page
            </h2>
            <ol className="list-decimal space-y-1 pl-6">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="inline-flex min-h-[44px] items-center text-primary underline underline-offset-2"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="space-y-8 text-foreground">
            {sections.map((section) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="scroll-mt-6 space-y-3">
                <h2 id={`${section.id}-title`} className="text-xl font-semibold text-foreground">
                  {section.title}
                </h2>
                {section.body}
              </section>
            ))}
          </div>

          <div className="mt-10 border-t border-border pt-6 text-center">
            <Link href="/" className="inline-flex min-h-[44px] items-center font-medium text-primary hover:underline">
              ← Back to {PRODUCT_BRAND.name}
            </Link>
          </div>
        </article>
      </main>
    </div>
  )
}
