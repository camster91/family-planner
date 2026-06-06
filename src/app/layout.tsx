import type { Metadata } from 'next'
import { PostHogProvider } from '@/components/providers/posthog-provider'
import { AnalyticsProvider } from '@/components/providers/analytics-provider'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
// Side-effect import: patches window.fetch on the client to auto-inject
// the CSRF token on state-changing API requests. Loaded once, lives forever.
import '@/lib/fetch-csrf'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://family.ashbi.ca'),
  title: {
    default: 'Family Planner — All-in-One Family Organizer',
    template: '%s — Family Planner',
  },
  description: 'Free family organizer with chore tracking, budget, shopping lists, shared calendar, and projects. Kids earn XP and rewards. No ads, no data selling.',
  keywords: ['family organizer', 'family planner', 'chore chart app', 'budget tracker', 'shopping list app', 'shared calendar', 'family budget', 'kids rewards', 'project planner', 'parenting app'],
  authors: [{ name: 'Ashbi Design' }],
  creator: 'Ashbi Design',
  publisher: 'Ashbi Design',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://family.ashbi.ca',
    siteName: 'Family Planner',
    title: 'Family Planner — All-in-One Family Organizer',
    description: 'Free family organizer with chore tracking, budget, shopping lists, shared calendar, and projects. No ads, no data selling.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Family Planner — Chores, budget, calendar, and projects in one app',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Family Planner — All-in-One Family Organizer',
    description: 'Free family organizer with chores, budget, shopping lists, shared calendar, and projects.',
    images: ['/og-image.png'],
    creator: '@ashbidesign',
  },
  alternates: {
    canonical: 'https://family.ashbi.ca',
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/icon-192.png',
    other: {
      rel: 'apple-touch-icon',
      url: '/icon-192.png',
    },
  },
  manifest: '/manifest.json',
  category: 'productivity',
  classification: 'Family & Parenting',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <PostHogProvider>
          <ToastProvider>
            <I18nProvider locale="en">
              <AnalyticsProvider>
                <div className="min-h-screen bg-[var(--surface-grouped)] text-label-primary antialiased">
                  {children}
                </div>
              </AnalyticsProvider>
            </I18nProvider>
          </ToastProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
