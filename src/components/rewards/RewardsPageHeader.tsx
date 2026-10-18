'use client'

import { Gift } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { LargeHeader } from '@/components/ui/large-header'
import { useRewardsText } from '@/i18n/rewards'

/**
 * The server supplies the household name, while the surrounding copy follows
 * the device locale after the i18n provider hydrates. The name is deliberately
 * rendered as received so household names are never translated or decorated.
 */
export function RewardsPageHeader({
  familyName,
  className,
}: {
  familyName?: string | null
  className?: string
}) {
  const rewardsText = useRewardsText()

  return (
    <LargeHeader
      title={rewardsText('pageTitle')}
      subtitle={familyName || rewardsText('pageSubtitle')}
      className={className}
    />
  )
}

export function RewardsNoFamilyState() {
  const rewardsText = useRewardsText()

  return (
    <EmptyState
      icon={Gift}
      glyphColor="rewards"
      title={rewardsText('noFamilyTitle')}
      description={rewardsText('noFamilyDescription')}
    />
  )
}
