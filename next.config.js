// Baseline security headers applied to every route, including paths that
// src/middleware.ts does not reach (its matcher skips /_next/static,
// /_next/image and favicon.ico) and responses the middleware returns early
// (CSRF rejections and redirects).
//
// Values deliberately mirror the headers src/middleware.ts sets so the two
// layers never disagree. If you change one, change the other.
//
// - Permissions-Policy keeps camera=(): the photo capture box uses
//   <input capture="environment">, which hands off to the OS camera app and is
//   not governed by the camera permission policy. Nothing in src calls
//   getUserMedia or the Geolocation API.
// - X-Frame-Options DENY: no route is intended to be framed. The Capacitor
//   Android shell loads the site as a top-level document, not in a frame.
// - HSTS is production-only so local http://localhost development keeps working.
//
// - Content-Security-Policy is sent in REPORT-ONLY mode: browsers log
//   violations to the console but block nothing. Watch for violations on the
//   tablet and phone flows, then switch the key to Content-Security-Policy.
//   'unsafe-inline' for scripts stays until Next.js inline scripts use nonces.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

function originOf(url) {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

// PostHog loads from and reports to its API host (and its asset CDN).
const analyticsOrigins = [
  originOf(process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://app.posthog.com'),
  'https://*.posthog.com',
].filter(Boolean)

const isDev = process.env.NODE_ENV !== 'production'

const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${analyticsOrigins.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${analyticsOrigins.join(' ')}${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

securityHeaders.push({ key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy })

if (process.env.NODE_ENV === 'production') {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  })
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    remotePatterns: [],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]
  },
}

module.exports = nextConfig
