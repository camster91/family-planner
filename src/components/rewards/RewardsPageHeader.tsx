'use client'

import Link from 'next/link'
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

export function RewardsPagingFailure() {
  const text = useRewardsText()
  return <div role="alert" className="card-apple p-5 space-y-3"><p>{text('pageInvalid')}</p><Link href="/dashboard/rewards" className="btn-tinted min-h-[44px]">{text('newestRewards')}</Link></div>
}


/** Same neutral copy for an absent, foreign, revoked or disabled focus. */
export function RewardNotificationUnavailable() {
  const text = useRewardsText()
  return <section aria-label={text('focusHeading')} className="card-apple m-4 p-5 space-y-3">
    <h2 className="section-header">{text('focusHeading')}</h2>
    <p role="status">{text('focusUnavailable')}</p>
    <div className="flex flex-wrap gap-2">
      <Link href="/dashboard/rewards" className="btn-tinted inline-flex min-h-[44px] items-center">{text('focusAll')}</Link>
      <Link href="/dashboard/today" className="btn-plain inline-flex min-h-[44px] items-center">{text('focusToday')}</Link>
    </div>
  </section>
}


export function RewardsReadUnavailable() {
  const text = useRewardsText()
  return <section aria-label={text('pageTitle')} className="card-apple m-4 p-5 space-y-3">
    <h2 className="section-header">{text('pageTitle')}</h2>
    <p role="status">{text('readUnavailable')}</p>
    <button type="button" onClick={() => window.location.reload()} className="btn-tinted min-h-[44px]">{text('reloadRewards')}</button>
    <Link href="/dashboard/today" className="btn-plain inline-flex min-h-[44px] items-center">{text('focusToday')}</Link>
  </section>
}
