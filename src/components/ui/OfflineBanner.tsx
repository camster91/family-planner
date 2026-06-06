'use client'

import * as React from 'react'
import { WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * OfflineBanner — fixed top bar shown when the app is offline.
 * Appears only when navigator.onLine is false.
 */
export function OfflineBanner() {
  const [isOnline, setIsOnline] = React.useState(true)

  React.useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div
      className={cn(
        'fixed top-0 left-0 right-0 z-[100]',
        'bg-[var(--warning)] text-white',
        'flex items-center justify-center gap-2 py-2 px-4',
        'text-subhead font-semibold',
        'animate-spring-in'
      )}
    >
      <WifiOff className="w-4 h-4" />
      <span>You&apos;re offline — changes will sync when connected</span>
    </div>
  )
}