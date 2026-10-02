'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * A Settings card that starts closed: a native <details>/<summary>, so it
 * opens with a tap, Enter or Space and needs no script. Used for long,
 * rarely changed sub-sections (calendar links, AI capture) to keep the page
 * short on a phone. The title stays a real heading inside the summary, so
 * heading navigation still finds it.
 *
 * `forceOpen` opens the section when it turns true, for example when a
 * calendar connection comes back with a result to show inside it.
 */
export default function SettingsDisclosure({
  id,
  headingId,
  title,
  description,
  icon,
  forceOpen = false,
  children,
}: {
  id?: string
  headingId?: string
  title: string
  description?: string
  icon?: ReactNode
  forceOpen?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (forceOpen && ref.current) ref.current.open = true
  }, [forceOpen])

  return (
    <details ref={ref} id={id} className="card group" aria-labelledby={headingId}>
      <summary className="-m-2 flex min-h-[44px] cursor-pointer list-none items-center gap-3 rounded-lg p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 [&::-webkit-details-marker]:hidden">
        {icon}
        <span className="min-w-0 flex-1">
          <h3 id={headingId} className="text-[17px] font-semibold text-gray-900">
            {title}
          </h3>
          {description && <span className="block text-sm text-gray-600">{description}</span>}
        </span>
        <ChevronDown
          className="h-5 w-5 shrink-0 text-gray-500 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div className="pt-5">{children}</div>
    </details>
  )
}
