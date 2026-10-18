'use client'

import * as React from 'react'
import { Printer, AlertCircle } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { useHandoffRecoveryText } from '@/i18n/handoff-recovery'
import { useDisplayLocale } from '@/components/ui/use-display-locale'

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
    fields.some((field) => !isNullableString(raw[field]))
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
    family: { name: raw.family.name },
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="text-caption-1 text-label-tertiary uppercase tracking-wide mb-2">{title}</h2>
      <div className="space-y-1.5 text-body text-label-primary">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <span className="text-label-secondary shrink-0">{label}:</span>
      <span className="text-label-primary">{value}</span>
    </div>
  )
}

function HandoffView({
  handoff,
  t,
  displayLocale,
}: {
  handoff: HandoffData
  t: (key: string, params?: Record<string, string | number>) => string
  displayLocale: string
}) {
  return (
    // `print-card` is what the page's print stylesheet keeps visible.
    <div className="print-card max-w-xl mx-auto space-y-6" data-testid="handoff-print-card">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-large-title font-display text-label-primary">
          {t('handoff.handoffFor', { family: handoff.family.name })}
        </h1>
        <p className="text-subhead text-label-secondary mt-1">{t('handoff.quickSitterBrief')}</p>
      </div>

      {/* Sitter info */}
      <div className="card-apple p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-title-2 font-semibold text-label-primary">{handoff.sitter_name}</h2>
            {handoff.sitter_phone && (
              <p className="text-callout text-label-secondary mt-0.5">{handoff.sitter_phone}</p>
            )}
          </div>
          {(handoff.arrival_time || handoff.departure_time) && (
            <div className="text-right">
              {handoff.arrival_time && (
                <div className="text-footnote text-label-secondary">
                  <span className="text-label-tertiary">{t('handoff.arrivalTime')}</span>
                  <br />
                  <span className="text-label-primary font-medium">
                    {new Date(handoff.arrival_time).toLocaleString(displayLocale)}
                  </span>
                </div>
              )}
              {handoff.departure_time && (
                <div className="text-footnote text-label-secondary mt-1">
                  <span className="text-label-tertiary">{t('handoff.departureTime')}</span>
                  <br />
                  <span className="text-label-primary font-medium">
                    {new Date(handoff.departure_time).toLocaleString(displayLocale)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Details */}
      <div className="card-apple p-5">
        <Section title={t('handoff.kidsBedtimes')}>
          <Field label={t('handoff.kidsBedtimes')} value={handoff.kids_bedtimes} />
        </Section>

        <Section title={t('handoff.whereSnacks')}>
          <Field label={t('handoff.whereSnacks')} value={handoff.where_snacks} />
        </Section>

        <Section title={t('handoff.pickupAuthorized')}>
          <Field label={t('handoff.pickupAuthorized')} value={handoff.pickup_authorized} />
        </Section>

        <Section title={t('handoff.codeWords')}>
          <Field label={t('handoff.codeWords')} value={handoff.code_words} />
        </Section>

        <Section title={t('handoff.petCare')}>
          <Field label={t('handoff.petCare')} value={handoff.pet_care} />
        </Section>

        <Section title={t('handoff.emergencyNotes')}>
          <Field label={t('handoff.emergencyNotes')} value={handoff.emergency_notes} />
        </Section>

        <Section title={t('handoff.houseNotes')}>
          <Field label={t('handoff.houseNotes')} value={handoff.house_notes} />
        </Section>

        <Section title={t('handoff.generalNotes')}>
          <Field label={t('handoff.generalNotes')} value={handoff.general_notes} />
        </Section>
      </div>

      {/* Print button */}
      <div className="text-center no-print">
        <button
          type="button"
          onClick={() => window.print()}
          className="btn-filled min-h-[44px] px-6 py-2.5 rounded-lg text-subhead font-semibold inline-flex items-center gap-2"
        >
          <Printer className="w-4 h-4" />
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
      <div className="min-h-screen bg-[var(--surface-grouped)] flex items-center justify-center">
        <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
      </div>
    )
  }

  if (loadError) {
    return (
      <div
        className="min-h-screen bg-[var(--surface-grouped)] flex flex-col items-center justify-center p-8"
        role="alert"
      >
        <AlertCircle className="w-12 h-12 text-label-tertiary mb-4" />
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
    )
  }

  if (notFound || !handoff) {
    return (
      <div className="min-h-screen bg-[var(--surface-grouped)] flex flex-col items-center justify-center p-8">
        <AlertCircle className="w-12 h-12 text-label-tertiary mb-4" />
        <h1 className="text-title-2 font-semibold text-label-primary">{t('handoff.linkInvalid')}</h1>
        <p className="text-subhead text-label-secondary mt-2 text-center">{t('handoff.linkInvalidDesc')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--surface-grouped)] py-8 px-4">
      <HandoffView handoff={handoff} t={t} displayLocale={displayLocale} />
    </div>
  )
}
