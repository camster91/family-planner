'use client'

/**
 * Global fetch wrapper that automatically adds the CSRF token to all
 * state-changing requests. Patches window.fetch once on import.
 *
 * This is loaded via the root layout so every page picks it up.
 * It's safer than migrating 66 individual fetch calls to use apiFetch.
 */

const CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_HEADER_NAME = 'X-CSRF-Token'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(
    new RegExp('(^|; )' + CSRF_COOKIE_NAME + '=([^;]*)')
  )
  return match ? decodeURIComponent(match[2]) : null
}

declare global {
  // eslint-disable-next-line no-var
  var __csrfPatched: boolean | undefined
}

if (typeof window !== 'undefined' && !globalThis.__csrfPatched) {
  globalThis.__csrfPatched = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = function patchedFetch(
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const method = (init?.method || (typeof input === 'object' && 'method' in input ? input.method : null) || 'GET').toUpperCase()
    const isStateChanging = !SAFE_METHODS.has(method)

    // Only inject CSRF for same-origin API calls
    let url: URL
    try {
      url = new URL(typeof input === 'string' ? input : (input as Request).url, window.location.origin)
    } catch {
      // Not a URL — pass through
      return originalFetch(input as any, init)
    }

    const isSameOriginApi = url.origin === window.location.origin && url.pathname.startsWith('/api/')

    if (isStateChanging && isSameOriginApi) {
      const token = getCsrfToken()
      if (token) {
        // Build new headers object
        const headers = new Headers(init?.headers || {})
        if (!headers.has(CSRF_HEADER_NAME)) {
          headers.set(CSRF_HEADER_NAME, token)
        }
        init = { ...init, headers, credentials: init?.credentials || 'same-origin' }
      } else {
        // No CSRF token yet — still ensure credentials are sent
        init = { ...init, credentials: init?.credentials || 'same-origin' }
      }
    } else if (isSameOriginApi) {
      // GET/etc — still ensure credentials for cookie auth
      init = { ...init, credentials: init?.credentials || 'same-origin' }
    }

    return originalFetch(input as any, init)
  }
}

export {}
