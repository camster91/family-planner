'use client'

import { usePathname } from 'next/navigation'
import { OfflineBanner } from '@/components/ui/offline-banner'

/**
 * The offline banner (O-41) for every page outside the app shell: the landing
 * page, sign-in, sign-up, join, password reset and the like. The dashboard and
 * device layouts mount their own (under their top bars), so it stays out of
 * those to avoid two banners.
 */
export function SiteOfflineBanner() {
  const pathname = usePathname() ?? ''
  if (ownsBanner(pathname)) return null
  return <OfflineBanner className="top-0" />
}

/** Routes whose own layout already shows the banner. */
export function ownsBanner(pathname: string): boolean {
  return /^\/(dashboard|device)(\/|$)/.test(pathname)
}
