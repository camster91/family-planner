import type { Metadata } from 'next'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import { DeviceUnavailable, RemovedScreen } from '@/components/device/StatusScreens'

export const metadata: Metadata = { title: 'Tablet disconnected' }
export const dynamic = 'force-dynamic'

/** Removed / expired tablet (SHARED_DEVICE.md §7, §8). No household name or data. */
export default function DeviceRemovedPage() {
  if (!isSharedDeviceEnabled()) return <DeviceUnavailable />
  return <RemovedScreen />
}
