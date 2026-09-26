import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import { DeviceUnavailable } from '@/components/device/StatusScreens'

export const metadata: Metadata = {
  title: 'Family tablet',
  robots: { index: false, follow: false },
}

// The kill switch is read per request, never baked in at build time.
export const dynamic = 'force-dynamic'

/**
 * Shared-tablet shell (#241, SHARED_DEVICE.md §7). Chrome-free: no dashboard
 * nav, no person profile, no session lookup. Every page under /device
 * authenticates only the device cookie, through /api/device/* on the client.
 */
export default function DeviceLayout({ children }: { children: ReactNode }) {
  if (!isSharedDeviceEnabled()) return <DeviceUnavailable />
  return <div className="min-h-screen bg-[var(--surface-grouped)]">{children}</div>
}
