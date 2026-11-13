'use client'

import * as React from 'react'
import { Lock, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useFeatureEnabled, useFeatures } from '@/components/providers/features-provider'
import type { FeatureKey } from '@/lib/features'
import { useCoreTranslation } from '@/i18n/core'
import { getFeatureDisplayCopy, getFeatureOffCopy } from '@/i18n/feature-display'
import type { Locale } from '@/i18n/types'

/**
 * FeatureGate — wraps a feature page. If the feature is disabled, shows
 * a calm "this is off" state with a link to turn it on. Otherwise renders children.
 */
export function FeatureGate({
  featureKey,
  children,
  headingLevel = 1,
}: {
  featureKey: FeatureKey
  children: React.ReactNode
  /**
   * The off state replaces the whole page, so its title is the page's h1.
   * Pass 2 only where the gate wraps a sheet shown over a page that keeps
   * its own h1.
   */
  headingLevel?: 1 | 2
}) {
  const enabled = useFeatureEnabled(featureKey)

  if (enabled) return <>{children}</>

  return <ClientFeatureOffState featureKey={featureKey} headingLevel={headingLevel} />
}

/** The off state with the viewer's role from the features provider. */
function ClientFeatureOffState({
  featureKey,
  headingLevel,
}: {
  featureKey: FeatureKey
  headingLevel: 1 | 2
}) {
  const { canManage } = useFeatures()
  const { locale } = useCoreTranslation()
  return (
    <FeatureOffState
      featureKey={featureKey}
      canManage={canManage}
      locale={locale}
      headingLevel={headingLevel}
    />
  )
}

/**
 * The calm "this is off" state. Server-gated pages can return this client
 * boundary; it reads the effective UI locale from the root provider.
 */
export function FeatureOffState({
  featureKey,
  canManage = true,
  copy,
  locale,
  headingLevel = 1,
  testId,
}: {
  featureKey: FeatureKey
  /** False for teens and children: they cannot open Features, so no button. */
  canManage?: boolean
  /** Optional route-owned localized copy while retaining the shared interaction. */
  copy?: FeatureOffStateCopy
  /** Locale used for the shared default copy. Route-owned copy stays authoritative. */
  locale?: Locale
  /** 1 by default: the off state stands in for the page. 2 inside a sheet. */
  headingLevel?: 1 | 2
  testId?: string
}) {
  const { locale: contextLocale } = useCoreTranslation()
  const effectiveLocale = locale ?? contextLocale
  const display = getFeatureDisplayCopy(effectiveLocale, featureKey)
  const defaultCopy = getFeatureOffCopy(effectiveLocale, display.title)
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
