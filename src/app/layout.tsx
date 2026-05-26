import type { Metadata } from 'next'
import { PostHogProvider } from '@/components/providers/posthog-provider'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://family.ashbi.ca'),
  title: {
    default: 'Family Planner — Turn Chores into a Game for Kids',
    template: '%s — Family Planner',
  },
  description: 'Free family chore app that gamifies household tasks. Kids earn XP, build streaks, and unlock rewards while parents track progress with less nagging. No ads, no data selling.',
  keywords: ['family chores', 'chore chart app', 'kids rewards', 'family organizer', 'chore tracker', 'parenting app', 'gamified chores'],
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
    title: 'Family Planner — Turn Chores into a Game for Kids',
    description: 'Free family chore app that gamifies household tasks. Kids earn XP, build streaks, and unlock rewards.',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Family Planner — Gamified chore tracking for families',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Family Planner — Turn Chores into a Game for Kids',
    description: 'Free family chore app. Kids earn XP, build streaks, and unlock rewards.',
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
              <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
                {children}
              </div>
            </I18nProvider>
          </ToastProvider>
        </PostHogProvider>
      </body>
    </html>
  )
}
