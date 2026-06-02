'use client'

/**
 * Client-side fetch wrapper that automatically:
 * 1. Includes credentials (cookie auth)
 * 2. Includes the CSRF token in X-CSRF-Token header for state-changing requests
 * 3. Normalizes error responses
 */

const CSRF_COOKIE_NAME = 'csrf_token'
const CSRF_HEADER_NAME = 'X-CSRF-Token'

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp('(^|; )' + CSRF_COOKIE_NAME + '=([^;]*)'))
  return match ? decodeURIComponent(match[2]) : null
}

export interface ApiOptions extends RequestInit {
  // When true, throws on non-2xx responses with a structured error
  throwOnError?: boolean
}

export async function apiFetch<T = unknown>(
  url: string,
  options: ApiOptions = {}
): Promise<T> {
  const { throwOnError = true, headers, ...rest } = options

  const isStateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(
    (rest.method || 'GET').toUpperCase()
  )

  const finalHeaders: Record<string, string> = {
    ...(headers as Record<string, string> || {}),
  }

  if (isStateChanging) {
    const token = getCsrfToken()
    if (token) {
      finalHeaders[CSRF_HEADER_NAME] = token
    }
  }

  // Don't set Content-Type for FormData — let the browser do it
  if (rest.body && !(rest.body instanceof FormData) && !finalHeaders['Content-Type']) {
    finalHeaders['Content-Type'] = 'application/json'
  }

  const res = await fetch(url, {
    ...rest,
    credentials: 'same-origin',
    headers: finalHeaders,
  })

  if (!res.ok) {
    let errorBody: any = {}
    try {
      errorBody = await res.json()
    } catch {
      errorBody = { error: `HTTP ${res.status}` }
    }
    if (throwOnError) {
      throw new Error(errorBody.error || `Request failed: ${res.status}`)
    }
    return errorBody as T
  }

  // Some endpoints return 204
  if (res.status === 204) return {} as T

  return (await res.json()) as T
}
