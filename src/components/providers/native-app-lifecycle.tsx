'use client'

import { useEffect } from 'react'
import { watchNativeResume } from '@/lib/native-app'

export function NativeAppLifecycle() {
  useEffect(() => watchNativeResume(() => window.dispatchEvent(new Event('focus'))), [])
  return null
}
