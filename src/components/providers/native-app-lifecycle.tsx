'use client'

import { useEffect } from 'react'
import { watchNativeApp } from '@/lib/native-app-lazy'

export function NativeAppLifecycle() {
  useEffect(() => watchNativeApp(native => native.watchNativeResume(() => window.dispatchEvent(new Event('focus')))), [])
  return null
}
