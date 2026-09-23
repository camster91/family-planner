'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const isProd = () => {
  if (typeof window === 'undefined') return false
  return window.location.hostname === 'family.ashbi.ca'
}

// Pages that never have a session; sending from here only produces 401 console noise.
const AUTH_PAGES = ['/login', '/register', '/forgot-password', '/reset-password', '/verify-email']
function isAuthPage(pathname: string) {
  return AUTH_PAGES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

function sendEvent(eventName: string, metadata?: Record<string, any>) {
  if (!isProd()) return
  if (typeof window !== 'undefined' && isAuthPage(window.location.pathname)) return

  fetch('/api/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: eventName,
      path: window.location.pathname,
      metadata,
    }),
  }).catch(() => {
    // Silently fail
  })
}

const debounced = new Map<string, number>()
function debouncedSendEvent(eventName: string, metadata?: Record<string, any>) {
  const key = eventName + JSON.stringify(metadata)
  const last = debounced.get(key)
  if (last && Date.now() - last < 100) return
  debounced.set(key, Date.now())
  sendEvent(eventName, metadata)
}

export function useAnalytics() {
  const pathname = usePathname()

  useEffect(() => {
    if (!pathname || pathname.startsWith('/api/')) return
    const timer = setTimeout(() => {
      sendEvent('page_view')
    }, 100)
    return () => clearTimeout(timer)
  }, [pathname])
}

export function trackEvent(eventName: string, metadata?: Record<string, any>) {
  debouncedSendEvent(eventName, metadata)
}
