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
// Follow-up (not done here): a Content-Security-Policy. It needs nonce/hash
// support for Next.js inline scripts and the analytics provider before it can
// be enforced without breaking the app.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

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
