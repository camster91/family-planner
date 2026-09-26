'use client'

import * as React from 'react'
import Link from 'next/link'
import { LogIn, TabletSmartphone, Unplug } from 'lucide-react'
import { useDeviceClient } from './use-device-client'
import { primaryButtonClass, screenCardClass } from './styles'

function ScreenShell({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <main
      data-testid={testId}
      className="flex min-h-screen items-center justify-center bg-[var(--surface-grouped)] px-4 py-10"
    >
      <div className={screenCardClass}>{children}</div>
    </main>
  )
}

/** Removes every device trace on this browser (§8) once, on mount. */
function useWipeOnMount() {
  const client = useDeviceClient()
  React.useEffect(() => {
    void client?.wipe()
  }, [client])
}

/**
 * "Removed / expired" tablet state (SHARED_DEVICE.md §7): no household name or
 * data, just the way back to pairing.
 */
export function RemovedScreen() {
  useWipeOnMount()
  return (
    <ScreenShell testId="device-removed">
      <Unplug className="h-12 w-12 text-label-secondary" aria-hidden="true" />
      <h1 className="mt-5 font-display text-[32px] font-bold leading-tight text-label-primary md:text-[40px]">
        This tablet is disconnected
      </h1>
      <p className="mt-3 text-[19px] leading-snug text-label-secondary md:text-[21px]">
        This tablet was disconnected from its household. A parent can pair it again.
      </p>
      <div className="mt-8">
        <Link href="/device/pair" replace className={primaryButtonClass}>
          <TabletSmartphone className="h-5 w-5" aria-hidden="true" />
          Pair this tablet
        </Link>
      </div>
    </ScreenShell>
  )
}

/** Kill switch off (SHARED_DEVICE.md §7 "Unavailable"). */
export function DeviceUnavailable() {
  useWipeOnMount()
  return (
    <ScreenShell testId="device-unavailable">
      <h1 className="font-display text-[32px] font-bold leading-tight text-label-primary md:text-[40px]">
        Tablet mode is not available right now.
      </h1>
      <p className="mt-3 text-[19px] leading-snug text-label-secondary md:text-[21px]">
        You can still sign in to Family Planner with your own account.
      </p>
      <div className="mt-8">
        <Link href="/login" className={primaryButtonClass}>
          <LogIn className="h-5 w-5" aria-hidden="true" />
          Sign in
        </Link>
      </div>
    </ScreenShell>
  )
}
