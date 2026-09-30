import type { Metadata } from 'next'
import { isSharedDeviceEnabled } from '@/lib/device-http'
import PairScreen from '@/components/device/PairScreen'
import { DeviceUnavailable } from '@/components/device/StatusScreens'

export const metadata: Metadata = { title: 'Pair this tablet' }
export const dynamic = 'force-dynamic'

/** Unpaired tablet: public, no session needed (SHARED_DEVICE.md §5.1). */
export default function DevicePairPage() {
  if (!isSharedDeviceEnabled()) return <DeviceUnavailable />
  return <PairScreen />
}
