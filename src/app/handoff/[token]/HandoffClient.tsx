'use client'

import * as React from 'react'
import { Printer, AlertCircle } from 'lucide-react'
import { useTranslation } from '@/i18n'

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

function HandoffView({ handoff, t }: { handoff: HandoffData; t: (key: string, params?: Record<string, string | number>) => string }) {
  return (
    <div className="max-w-xl mx-auto space-y-6">
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
                    {new Date(handoff.arrival_time).toLocaleString()}
                  </span>
                </div>
              )}
              {handoff.departure_time && (
                <div className="text-footnote text-label-secondary mt-1">
                  <span className="text-label-tertiary">{t('handoff.departureTime')}</span>
                  <br />
                  <span className="text-label-primary font-medium">
                    {new Date(handoff.departure_time).toLocaleString()}
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
          onClick={() => window.print()}
          className="btn-filled px-6 py-2.5 rounded-lg text-subhead font-semibold inline-flex items-center gap-2"
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
  const [handoff, setHandoff] = React.useState<HandoffData | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    fetch(`/api/handoff/share/${token}`)
      .then((res) => {
        if (res.status === 404) {
          setNotFound(true)
          return null
        }
        if (!res.ok) throw new Error('Not found')
        return res.json()
      })
      .then((data) => {
        if (data) setHandoff(data.handoff)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--surface-grouped)] flex items-center justify-center">
        <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
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
      <HandoffView handoff={handoff} t={t} />
    </div>
  )
}
