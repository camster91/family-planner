'use client'

import * as React from 'react'
import { Printer, AlertCircle, AlertTriangle } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useHandoffRecoveryText, type HandoffRecoveryMessage } from '@/i18n/handoff-recovery'
import { useDisplayLocale } from '@/components/ui/use-display-locale'
import { PhoneLink, TextWithPhoneLinks } from '@/components/ui/phone-link'
import { formatHandoffTime } from '@/lib/handoff-format'

interface HandoffData {
  id: string
  sitter_name: string
  sitter_phone: string | null
  arrival_time: string | null
  departure_time: string | null
  kids_bedtimes: string | null
  where_snacks: string | null
  pickup_authorized: string | null
  code_words: string | null
  pet_care: string | null
  emergency_notes: string | null
  house_notes: string | null
  general_notes: string | null
  /** When the share link stops working. Optional for older servers. */
  link_expires_at: string | null
  family: { name: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function parseHandoffData(value: unknown): HandoffData | null {
  if (!isRecord(value) || !isRecord(value.handoff)) return null
  const raw = value.handoff
  const fields = [
    'sitter_phone',
    'arrival_time',
    'departure_time',
    'kids_bedtimes',
    'where_snacks',
    'pickup_authorized',
    'code_words',
    'pet_care',
    'emergency_notes',
    'house_notes',
    'general_notes',
  ] as const
  if (
    typeof raw.id !== 'string' ||
    typeof raw.sitter_name !== 'string' ||
    !isRecord(raw.family) ||
    typeof raw.family.name !== 'string' ||
    fields.some((field) => !isNullableString(raw[field])) ||
    !(raw.link_expires_at === undefined || isNullableString(raw.link_expires_at))
  ) {
    return null
  }
  const nullable = (field: (typeof fields)[number]) => raw[field] as string | null
  return {
    id: raw.id,
    sitter_name: raw.sitter_name,
    sitter_phone: nullable('sitter_phone'),
    arrival_time: nullable('arrival_time'),
    departure_time: nullable('departure_time'),
    kids_bedtimes: nullable('kids_bedtimes'),
    where_snacks: nullable('where_snacks'),
    pickup_authorized: nullable('pickup_authorized'),
    code_words: nullable('code_words'),
    pet_care: nullable('pet_care'),
    emergency_notes: nullable('emergency_notes'),
    house_notes: nullable('house_notes'),
    general_notes: nullable('general_notes'),
    link_expires_at: typeof raw.link_expires_at === 'string' ? raw.link_expires_at : null,
    family: { name: raw.family.name },
  }
}

type Translate = (key: string, params?: Record<string, string | number>) => string

function DetailSection({
  title,
  value,
  callLabel,
  nested = false,
}: {
  title: string
  value: string | null
  callLabel: (number: string) => string
  /** Inside the emergency block, under its own heading. */
  nested?: boolean
}) {
  // Empty sections are hidden, and the heading is the only label.
  if (!value?.trim()) return null
  const Heading = nested ? 'h3' : 'h2'
  return (
    <section className="space-y-1">
      <Heading className="text-subhead font-semibold text-label-primary">{title}</Heading>
      <p className="whitespace-pre-line break-words text-body text-label-primary">
        <TextWithPhoneLinks text={value} callLabel={callLabel} />
      </p>
    </section>
  )
}

function HandoffView({
  handoff,
  t,
  text,
  displayLocale,
}: {
  handoff: HandoffData
  t: Translate
  text: (key: HandoffRecoveryMessage, params?: Record<string, string | number>) => string
  displayLocale: string
}) {
  const callLabel = (number: string) => text('callNumber', { number })
  const arrival = formatHandoffTime(handoff.arrival_time, displayLocale)
  const departure = formatHandoffTime(handoff.departure_time, displayLocale)
  const linkUntil = formatHandoffTime(handoff.link_expires_at, displayLocale)
  const hasEmergency = Boolean(handoff.emergency_notes?.trim() || handoff.pickup_authorized?.trim())
  const details: Array<[string, string | null]> = [
    [t('handoff.kidsBedtimes'), handoff.kids_bedtimes],
    [t('handoff.whereSnacks'), handoff.where_snacks],
    [t('handoff.codeWords'), handoff.code_words],
    [t('handoff.petCare'), handoff.pet_care],
    [t('handoff.houseNotes'), handoff.house_notes],
    [t('handoff.generalNotes'), handoff.general_notes],
  ]
  const hasDetails = details.some(([, value]) => Boolean(value?.trim()))

  return (
    // `print-card` is what the page's print stylesheet keeps visible.
    <div className="print-card max-w-xl mx-auto space-y-6" data-testid="handoff-print-card">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-large-title font-display text-label-primary break-words">
          {t('handoff.handoffFor', { family: handoff.family.name })}
        </h1>
        <p className="text-subhead text-label-secondary mt-1">{t('handoff.quickSitterBrief')}</p>
        {linkUntil && (
          <p className="text-footnote text-label-secondary mt-1" data-testid="handoff-link-expiry">
            {text('publicWorksUntil', { date: linkUntil })}
          </p>
        )}
      </div>

      {/* Emergency first: what a sitter needs when something goes wrong. */}
      {hasEmergency && (
        <section
          aria-labelledby="handoff-emergency-heading"
          className="rounded-2xl border-2 border-danger-text bg-[var(--danger-tint)] p-5 space-y-4"
          data-testid="handoff-emergency"
        >
          <h2
            id="handoff-emergency-heading"
            className="flex items-center gap-2 text-title-3 font-semibold text-danger-text"
          >
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
            {text('emergencyHeading')}
          </h2>
          <DetailSection nested title={t('handoff.emergencyNotes')} value={handoff.emergency_notes} callLabel={callLabel} />
          <DetailSection
            nested
            title={t('handoff.pickupAuthorized')}
            value={handoff.pickup_authorized}
            callLabel={callLabel}
          />
        </section>
      )}

      {/* Sitter and times */}
      <section className="card-apple p-5 space-y-3" aria-labelledby="handoff-sitter-name">
        <div>
          <h2 id="handoff-sitter-name" className="text-title-2 font-semibold text-label-primary break-words">
            {handoff.sitter_name}
          </h2>
          {handoff.sitter_phone && (
            <PhoneLink number={handoff.sitter_phone} label={callLabel(handoff.sitter_phone)} />
          )}
        </div>
        {(arrival || departure) && (
          <dl className="grid grid-cols-1 gap-2 text-subhead sm:grid-cols-2">
            {arrival && (
              <div>
                <dt className="text-label-secondary">{t('handoff.arrivalTime')}</dt>
                <dd className="font-medium text-label-primary">{arrival}</dd>
              </div>
            )}
            {departure && (
              <div>
                <dt className="text-label-secondary">{t('handoff.departureTime')}</dt>
                <dd className="font-medium text-label-primary">{departure}</dd>
              </div>
            )}
          </dl>
        )}
      </section>

      {/* Details: only what the parent filled in. */}
      {hasDetails && (
        <div className="card-apple p-5 space-y-5" data-testid="handoff-details">
          {details.map(([title, value]) => (
            <DetailSection key={title} title={title} value={value} callLabel={callLabel} />
          ))}
        </div>
      )}

      {/* Print button */}
      <div className="text-center no-print">
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-filled min-h-[44px] px-6 py-2.5 rounded-lg text-subhead font-semibold inline-flex items-center gap-2"
        >
          <Printer className="w-4 h-4" aria-hidden="true" />
          {t('handoff.print')}
        </button>
      </div>
    </div>
  )
}

export function HandoffClient({ token }: { token: string }) {
  const { t } = useTranslation()
  const text = useHandoffRecoveryText()
  const displayLocale = useDisplayLocale()
  const [handoff, setHandoff] = React.useState<HandoffData | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [loadError, setLoadError] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const requestRef = React.useRef(0)
  const controllerRef = React.useRef<AbortController | null>(null)

  const load = React.useCallback(() => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const requestId = ++requestRef.current

    setLoading(true)
    setNotFound(false)
    setLoadError(false)
    setHandoff(null)
    void (async () => {
      try {
        const res = await fetch(`/api/handoff/share/${token}`, { signal: controller.signal })
        if (controller.signal.aborted || requestId !== requestRef.current) return
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        if (!res.ok) throw new Error('Handoff share could not load')
        const data = await res.json()
        const parsed = parseHandoffData(data)
        if (!parsed) throw new Error('Malformed handoff share response')
        if (controller.signal.aborted || requestId !== requestRef.current) return
        setHandoff(parsed)
      } catch {
        if (controller.signal.aborted || requestId !== requestRef.current) return
        setLoadError(true)
      } finally {
        if (requestId !== requestRef.current) return
        setLoading(false)
      }
    })()
  }, [token])

  React.useEffect(() => {
    load()
    return () => {
      controllerRef.current?.abort()
      requestRef.current += 1
    }
  }, [load])

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--surface-grouped)] flex items-center justify-center">
        <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="min-h-screen bg-[var(--surface-grouped)] flex flex-col items-center justify-center p-8">
        <div role="alert" className="flex flex-col items-center">
          <AlertCircle className="w-12 h-12 text-label-tertiary mb-4" aria-hidden="true" />
          <h1 className="text-title-2 font-semibold text-label-primary text-center">{text('publicLoadErrorTitle')}</h1>
          <p className="text-subhead text-label-secondary mt-2 text-center">{text('publicLoadErrorDescription')}</p>
          <button
            type="button"
            onClick={load}
            className="btn-tinted mt-5 min-h-[44px] px-5"
          >
            {t('routeState.tryAgain')}
          </button>
        </div>
      </main>
    )
  }

  if (notFound || !handoff) {
    return (
      <main className="min-h-screen bg-[var(--surface-grouped)] flex flex-col items-center justify-center p-8">
        <AlertCircle className="w-12 h-12 text-label-tertiary mb-4" aria-hidden="true" />
        <h1 className="text-title-2 font-semibold text-label-primary">{t('handoff.linkInvalid')}</h1>
        <p className="text-subhead text-label-secondary mt-2 text-center">{t('handoff.linkInvalidDesc')}</p>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--surface-grouped)] py-8 px-4">
      <HandoffView handoff={handoff} t={t} text={text} displayLocale={displayLocale} />
    </main>
  )
}
