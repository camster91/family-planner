'use client'

import * as React from 'react'
import { Lock, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useFeatureEnabled, useFeatures } from '@/components/providers/features-provider'
import type { FeatureKey } from '@/lib/features'
import { useTranslation } from '@/i18n'
import { getFeatureDisplayCopy, getFeatureOffCopy } from '@/i18n/feature-display'
import type { Locale } from '@/i18n/types'

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
  const enabled = useFeatureEnabled(featureKey)

  if (enabled) return <>{children}</>

  return <ClientFeatureOffState featureKey={featureKey} />
}

/** The off state with the viewer's role from the features provider. */
function ClientFeatureOffState({ featureKey }: { featureKey: FeatureKey }) {
  const { canManage } = useFeatures()
  const { locale } = useTranslation()
  return <FeatureOffState featureKey={featureKey} canManage={canManage} locale={locale} />
}

/**
 * The calm "this is off" state. No hooks, so server components can render it
 * too (the rewards page gates on the server, #248).
 */
export function FeatureOffState({
  featureKey,
  canManage = true,
  copy,
  locale = 'en',
  headingLevel = 2,
  testId,
}: {
  featureKey: FeatureKey
  /** False for teens and children: they cannot open Features, so no button. */
  canManage?: boolean
  /** Optional route-owned localized copy while retaining the shared interaction. */
  copy?: FeatureOffStateCopy
  /** Locale used for the shared default copy. Route-owned copy stays authoritative. */
  locale?: Locale
  headingLevel?: 1 | 2
  testId?: string
}) {
  const display = getFeatureDisplayCopy(locale, featureKey)
  const defaultCopy = getFeatureOffCopy(locale, display.title)
  const Heading = headingLevel === 1 ? 'h1' : 'h2'

  return (
    <div data-testid={testId} className="max-w-md mx-auto py-12 text-center animate-spring-up">
      <div className="empty-state-icon mx-auto">
        <Lock className="w-9 h-9 text-white" />
      </div>
      <Heading className="text-title-2 mb-2">
        {copy?.title ?? defaultCopy.title}
      </Heading>
      <p className="text-body text-label-secondary mb-6">
        {canManage
          ? (copy?.description ?? defaultCopy.description)
          : (copy?.askParent ?? defaultCopy.askParent)}
      </p>
      {canManage && (
        <Link
          href="/dashboard/features"
          className="btn-filled"
        >
          {copy?.openFeatures ?? defaultCopy.openFeatures}
          <ChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}

export type FeatureOffStateCopy = {
  title: string
  description: string
  askParent: string
  openFeatures: string
}
