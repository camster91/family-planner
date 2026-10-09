import type { Metadata, Viewport } from 'next'
import { PRODUCT_BRAND } from '@/lib/brand'
import localFont from 'next/font/local'
import { PostHogProvider } from '@/components/providers/posthog-provider'
import { ThemeProvider } from '@/components/providers/theme-provider'
import { THEME_INIT_SCRIPT } from '@/lib/theme'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import { isPseudolocaleEnabled } from '@/i18n/pseudo'
import { CsrfFetchPatch } from '@/components/providers/csrf-fetch-patch'
import { ServiceWorkerRegistration } from '@/components/providers/service-worker-registration'
import { SiteOfflineBanner } from '@/components/ui/site-offline-banner'
import './globals.css'

// Approved Woven Grove fonts, vendored with SIL OFL licenses. Builds and
// browsers need no font-provider network. Variable Manrope supplies real UI
// weights 400/500/600/700; Newsreader display headings retain weight 600.
const newsreader = localFont({
  src: './fonts/Newsreader-variable.ttf',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-newsreader',
})

const manrope = localFont({
  src: './fonts/Manrope-variable.ttf',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-manrope',
})

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F4EC' },
    { media: '(prefers-color-scheme: dark)', color: '#11211E' },
  ],
}

// One public preview asset for both protocols; no household data is embedded.
const socialPreview = {
  url: '/brand/woven-grove/herewoven-social.png',
  width: 1200,
  height: 630,
  type: 'image/png',
  alt: 'Herewoven — Everyday life, held together. A woven H above interwoven bands.',
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
    images: [socialPreview],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${PRODUCT_BRAND.name} — Household organizer`,
    description: PRODUCT_BRAND.description,
    creator: '@ashbidesign',
    images: [socialPreview],
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
    <html lang="en" data-pseudolocalized={isPseudolocaleEnabled() ? 'true' : undefined} className={`${newsreader.variable} ${manrope.variable}`} suppressHydrationWarning>
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
            <I18nProvider locale="en" persistLocale pseudolocalize={isPseudolocaleEnabled()}>
              <ToastProvider>
                <div className="min-h-screen bg-[var(--surface-grouped)] text-label-primary antialiased">
                  {children}
                </div>
              </ToastProvider>
            </I18nProvider>
          </PostHogProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
