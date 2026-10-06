import type { Metadata, Viewport } from 'next'
import { PRODUCT_BRAND } from '@/lib/brand'
import { Fraunces, Inter } from 'next/font/google'
import { PostHogProvider } from '@/components/providers/posthog-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import { CsrfFetchPatch } from '@/components/providers/csrf-fetch-patch'
import { ServiceWorkerRegistration } from '@/components/providers/service-worker-registration'
import { SiteOfflineBanner } from '@/components/ui/site-offline-banner'
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
    { media: '(prefers-color-scheme: dark)', color: '#171420' },
  ],
}

export const metadata: Metadata = {
  metadataBase: new URL('https://family.ashbi.ca'),
  title: {
    default: `${PRODUCT_BRAND.name} — Household organizer`,
    template: `%s — ${PRODUCT_BRAND.name}`,
  },
  description: PRODUCT_BRAND.description,
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
    siteName: PRODUCT_BRAND.name,
    title: `${PRODUCT_BRAND.name} — Household organizer`,
    description: PRODUCT_BRAND.description,
    // Retain the original OG file, but do not advertise its baked-in legacy name.
  },
  twitter: {
    card: 'summary',
    title: `${PRODUCT_BRAND.name} — Household organizer`,
    description: PRODUCT_BRAND.description,
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
    // suppressHydrationWarning: THEME_INIT_SCRIPT adds `dark` to <html> before
    // React hydrates, so its class can differ from the server HTML.
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        {/* Theme before first paint (O-43): Auto unless this device saved Light or Dark. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="font-sans">
        <CsrfFetchPatch />
        <ServiceWorkerRegistration />
        <SiteOfflineBanner />
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
