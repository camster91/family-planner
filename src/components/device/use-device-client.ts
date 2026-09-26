'use client'

import * as React from 'react'
import { DeviceApiError, getDeviceClient, type DeviceClient } from '@/lib/device-client'

/** The tab's device client, or null during server rendering (never used there). */
export function useDeviceClient(): DeviceClient | null {
  return React.useMemo(() => (typeof window === 'undefined' ? null : getDeviceClient()), [])
}

export interface DeviceMe {
  device: { id: string; label: string }
  household: { name: string }
  features: { calendar: boolean; chores: boolean; meals: boolean; lists: boolean }
  parents: Array<{ id: string; name: string; hasPin: boolean }>
  elevation: { active: boolean; memberId: string | null; expiresAt: string | null }
}

/** "about 3 minutes" from a Retry-After in seconds. */
export function waitText(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 60) return 'about a minute'
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 90) return `about ${minutes} minutes`
  return `about ${Math.round(minutes / 60)} hours`
}

/** Plain-language message for an error the tablet cannot act on itself. */
export function genericErrorText(error: unknown): string {
  if (error instanceof DeviceApiError) {
    if (error.code === 'NETWORK_ERROR') return 'Could not reach Family Planner. Check the Wi-Fi and try again.'
    if (error.status === 429) return `Too many tries. Wait ${waitText(error.retryAfterSeconds)}, then try again.`
    if (error.code === 'SERVICE_UNAVAILABLE') return 'Family Planner is busy right now. Trying again shortly.'
  }
  return 'Something went wrong. Try again.'
}

/** m:ss for a countdown. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
