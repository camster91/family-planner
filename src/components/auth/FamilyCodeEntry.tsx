'use client'

import Link from 'next/link'
import { useFamilyCodeEntryText } from '@/i18n/family-code-entry'
import { cn } from '@/lib/utils'

/** "Have a family code? Join your family" — the way in for someone joining, not starting, a household. */
export function FamilyCodeEntry({ className, linkClassName }: { className?: string; linkClassName?: string }) {
  const text = useFamilyCodeEntryText()
  return (
    <p data-testid="family-code-entry" className={className}>
      {text('haveCode')}{' '}
      <Link href="/join" className={cn('inline-flex min-h-11 items-center', linkClassName)}>
        {text('joinYourFamily')}
      </Link>
    </p>
  )
}
