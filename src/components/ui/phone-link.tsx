import * as React from 'react'
import { Phone } from 'lucide-react'
import { splitPhoneNumbers, telHref } from '@/lib/handoff-format'

/**
 * A tap-to-call link that always shows the number as text, so it can be read
 * aloud or dialled by hand. 44px tall for touch. Falls back to plain text when
 * the value does not look like a phone number.
 */
export function PhoneLink({
  number,
  label,
  className,
}: {
  number: string
  /** Accessible name, e.g. "Call Sam, 555-0100". */
  label: string
  className?: string
}) {
  const href = telHref(number)
  if (!href) return <span className={className}>{number}</span>
  return (
    <a
      href={href}
      aria-label={label}
      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg font-semibold text-[var(--accent-text)] underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)] ${className ?? ''}`}
    >
      <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{number}</span>
    </a>
  )
}

/** Free text exactly as written, with any phone numbers in it made tappable. */
export function TextWithPhoneLinks({
  text,
  callLabel,
}: {
  text: string
  callLabel: (number: string) => string
}) {
  return (
    <>
      {splitPhoneNumbers(text).map((segment, index) =>
        segment.kind === 'phone' ? (
          <PhoneLink key={index} number={segment.text} label={callLabel(segment.text)} />
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  )
}
