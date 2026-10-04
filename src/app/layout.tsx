import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'
import { PostHogProvider } from '@/components/providers/posthog-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import { CsrfFetchPatch } from '@/components/providers/csrf-fetch-patch'
import { ServiceWorkerRegistration } from '@/components/providers/service-worker-registration'
import './globals.css'

// Warm Paper type (docs/product/BRAND.md): Fraunces for headings, Inter for
// everything else. next/font downloads both at build time and serves them
// from this origin, so there is no runtime request to Google (CSP font-src
// 'self' is enough). The CSS variables feed the type classes in globals.css.
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['opsz', 'SOFT'],
})

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBF7F0' },
    { media: '(prefers-color-scheme: dark)', color: '#121A2B' },
  ],
}

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
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        type: 'image/jpeg',
        alt: 'Family Planner: chores, calendar, meals and lists, together. A paper-cut house beside a checklist.',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Family Planner — All-in-One Family Organizer',
    description: 'Free family organizer with chores, budget, shopping lists, shared calendar, and projects.',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Family Planner: chores, calendar, meals and lists, together. A paper-cut house beside a checklist.',
      },
    ],
    creator: '@ashbidesign',
  },
  alternates: {
    canonical: 'https://family.ashbi.ca',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-48.png', sizes: '48x48', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
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
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="font-sans">
        <CsrfFetchPatch />
        <ServiceWorkerRegistration />
        <ThemeProvider>
          <PostHogProvider>
            <ToastProvider>
              <I18nProvider locale="en" persistLocale>
                <div className="min-h-screen bg-[var(--surface-grouped)] text-label-primary antialiased">
                  {children}
                </div>
              </I18nProvider>
            </ToastProvider>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
