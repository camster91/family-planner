'use client'

import * as React from 'react'
import { Lock, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useFeatures } from '@/components/providers/features-provider'
import type { FeatureKey } from '@/lib/features'
import { FEATURES } from '@/lib/features'

/**
 * FeatureGate — wraps a feature page. If the feature is disabled, shows
 * a calm "this is off" state with a link to turn it on. Otherwise renders children.
 */
export function FeatureGate({
  featureKey,
  children,
}: {
  featureKey: FeatureKey
  children: React.ReactNode
}) {
  const { features } = useFeatures()
  const enabled = features[featureKey] === true

  if (enabled) return <>{children}</>

  const meta = FEATURES.find((f) => f.key === featureKey)

  return (
    <div className="max-w-md mx-auto py-12 text-center animate-spring-up">
      <div className="empty-state-icon mx-auto">
        <Lock className="w-9 h-9 text-white" />
      </div>
      <h2 className="text-title-2 mb-2">{meta?.title ?? 'Feature'} is off</h2>
      <p className="text-body text-label-secondary mb-6">
        {meta?.title ?? 'This feature'} is turned off for your family. A parent can turn it on in Features settings.
      </p>
      <Link
        href="/dashboard/features"
        className="btn-filled"
      >
        Open Features
        <ChevronRight className="w-4 h-4" />
      </Link>
    </div>
  )
}
