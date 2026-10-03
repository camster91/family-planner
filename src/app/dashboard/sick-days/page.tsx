'use client'

import * as React from 'react'
import { Thermometer, Plus, Check } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { Avatar } from '@/components/ui/avatar'
import { useTranslation } from '@/i18n'
import { useToast } from '@/components/ui/toast'
import { Dialog } from '@/components/ui/dialog'
import { OFFLINE_MESSAGE, responseErrorMessage } from '@/lib/fetch-error'

interface TemperatureEntry {
  value: number
  unit: string
  at: string
}

interface Medication {
  id: string
  sick_day_id: string | null
  person_id: string
  name: string
  dosage: string
  schedule: string
  next_dose_at: string | null
  last_dose_at: string | null
  active: boolean
  notes: string | null
}

interface SickDay {
  id: string
  person_id: string
  person_name: string
  person_avatar: string | null
  started_at: string
  ended_at: string | null
  symptoms: string | null
  severity: string
  status: string
  temperature_log: TemperatureEntry[] | null
  notes: string | null
  medications: Medication[]
}

interface FamilyMember {
  id: string
  name: string
  avatar_url?: string | null
}

/**
 * A labelled field. The label is tied to the control with `htmlFor`/`id`, so
 * the control is passed as a render function that receives the id.
 */
function FormField({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = React.useId()
  return (
    <div>
      <label htmlFor={id} className="block text-caption-1 text-label-secondary mb-1">
        {label}
      </label>
      {children(id)}
    </div>
  )
}

const SELECT_CLASS =
  'w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]'
const TEXTAREA_CLASS =
  'w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none'
// A text-style action ("+ Add temperature") with a 44px tap area.
const TEXT_ACTION_CLASS =
  'inline-flex min-h-[44px] items-center -mr-3 px-3 rounded-[var(--radius-md)] text-subhead font-medium text-[var(--accent-text)] focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]'

function Input({
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
  step,
  inputMode,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  className?: string
  step?: string
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      step={step}
      inputMode={inputMode}
      className={`w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${className ?? ''}`}
    />
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    mild: 'bg-[var(--success-tint)] text-success-text',
    moderate: 'bg-[var(--warning-tint)] text-warning-text',
    severe: 'bg-[var(--danger-tint)] text-danger-text',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-caption-1 font-semibold ${colors[severity] ?? 'bg-muted text-muted-foreground'}`}>
      {severity}
    </span>
  )
}

export default function SickDaysPage() {
  return (
    <FeatureGate featureKey="sick-days">
      <SickDaysPageInner />
    </FeatureGate>
  )
}

function SickDaysPageInner() {
  const { t } = useTranslation()
  const [sickDays, setSickDays] = React.useState<SickDay[]>([])
  const [members, setMembers] = React.useState<FamilyMember[]>([])
  const [loading, setLoading] = React.useState(true)
  // Only the first load replaces the page with "Loading"; later reloads keep
  // the list and any open sheet on screen.
  const [loadedOnce, setLoadedOnce] = React.useState(false)
  // The list could not be loaded: show that, not "no sick days".
  const [loadFailed, setLoadFailed] = React.useState(false)
  const { addToast } = useToast()
  const [showStartModal, setShowStartModal] = React.useState(false)
  // The open sick day is kept by id and read from the current list, so a
  // reload (after a temperature, medication or dose) shows the saved data.
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const selectedSickDay = React.useMemo(
    () => (selectedId ? sickDays.find((sd) => sd.id === selectedId) ?? null : null),
    [sickDays, selectedId]
  )
  const [showAddTempModal, setShowAddTempModal] = React.useState(false)
  const [showAddMedModal, setShowAddMedModal] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [userRole, setUserRole] = React.useState<string>('child')
  const [userId, setUserId] = React.useState<string | null>(null)

  // Start sick day form
  const [startForm, setStartForm] = React.useState({ person_id: '', severity: 'mild', symptoms: '' })

  // Add temperature form
  const [tempForm, setTempForm] = React.useState({ value: '', unit: 'F' })

  // Add medication form
  const [medForm, setMedForm] = React.useState({ person_id: '', name: '', dosage: '', schedule: '', notes: '' })

  // After a parent logs a dose, offer to set the next dose time. The app never
  // guesses it from the free-text schedule ("Every 4-6 hours").
  const [nextDoseFor, setNextDoseFor] = React.useState<string | null>(null)
  const [nextDoseHours, setNextDoseHours] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [sd, fm, me] = await Promise.all([
        fetch('/api/sick-days', { cache: 'no-store' }).then((r) => {
          if (!r.ok) throw new Error('sick-days load failed')
          return r.json()
        }),
        fetch('/api/family/members', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ members: [] })),
        fetch('/api/medications', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ medications: [] })),
      ])
      setLoadFailed(false)
      setMembers(fm.members || [])
      // Merge medications into sick days
      const meds: Medication[] = me.medications || []
      setSickDays(
        ((sd.sickDays || []) as SickDay[]).map((day) => ({
          ...day,
          medications: meds.filter(
            (m) => m.sick_day_id === day.id || (!m.sick_day_id && m.person_id === day.person_id)
          ),
        }))
      )
    } catch {
      setLoadFailed(true)
    } finally {
      setLoading(false)
      setLoadedOnce(true)
    }
  }, [])

  // KidHome pattern: a refused or failed request says so in a toast instead
  // of doing nothing (or leaving an unhandled rejection when offline).
  const failed = React.useCallback(
    async (title: string, res?: Response) => {
      addToast({ type: 'error', title, message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE })
    },
    [addToast]
  )

  React.useEffect(() => {
    load()
    // Get user role from me endpoint
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role)
      if (d.user?.id) setUserId(d.user.id)
    }).catch(() => {})
  }, [load])

  async function startSickDay(e: React.FormEvent) {
    e.preventDefault()
    if (!startForm.person_id || !startForm.severity) return
    setSaving(true)
    try {
      const res = await fetch('/api/sick-days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(startForm),
      })
      if (res.ok) {
        setShowStartModal(false)
        setStartForm({ person_id: '', severity: 'mild', symptoms: '' })
        load()
      } else {
        await failed("Couldn't start the sick day", res)
      }
    } catch {
      await failed("Couldn't start the sick day")
    } finally {
      setSaving(false)
    }
  }

  async function addTemperature(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedSickDay || !tempForm.value) return
    setSaving(true)
    try {
      const res = await fetch(`/api/sick-days/${selectedSickDay.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addTemperature: { value: parseFloat(tempForm.value), unit: tempForm.unit },
        }),
      })
      if (res.ok) {
        setShowAddTempModal(false)
        setTempForm({ value: '', unit: 'F' })
        await load()
      } else {
        await failed("Couldn't save the temperature", res)
      }
    } catch {
      await failed("Couldn't save the temperature")
    } finally {
      setSaving(false)
    }
  }

  async function endSickness() {
    if (!selectedSickDay) return
    setSaving(true)
    try {
      const res = await fetch(`/api/sick-days/${selectedSickDay.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endedAt: new Date().toISOString() }),
      })
      if (res.ok) {
        setSelectedId(null)
        load()
      } else {
        await failed("Couldn't end the sick day", res)
      }
    } catch {
      await failed("Couldn't end the sick day")
    } finally {
      setSaving(false)
    }
  }

  async function addMedication(e: React.FormEvent) {
    e.preventDefault()
    if (!medForm.person_id || !medForm.name || !medForm.dosage || !medForm.schedule) return
    setSaving(true)
    try {
      const res = await fetch('/api/medications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...medForm, sick_day_id: selectedSickDay?.id || null }),
      })
      if (res.ok) {
        setShowAddMedModal(false)
        setMedForm({ person_id: '', name: '', dosage: '', schedule: '', notes: '' })
        await load()
      } else {
        await failed("Couldn't add the medication", res)
      }
    } catch {
      await failed("Couldn't add the medication")
    } finally {
      setSaving(false)
    }
  }

  // Show the saved dose times straight away, before the reload finishes.
  function applyMedication(updated: Pick<Medication, 'id' | 'last_dose_at' | 'next_dose_at'> | undefined) {
    if (!updated) return
    setSickDays((prev) =>
      prev.map((day) => ({
        ...day,
        medications: day.medications.map((m) =>
          m.id === updated.id ? { ...m, last_dose_at: updated.last_dose_at, next_dose_at: updated.next_dose_at } : m
        ),
      }))
    )
  }

  async function markDoseTaken(medId: string) {
    try {
      const res = await fetch(`/api/medications/${medId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markDoseTaken: true }),
      })
      if (!res.ok) {
        await failed("Couldn't log the dose", res)
        return
      }
      const data = await res.json().catch(() => null)
      applyMedication(data?.medication)
      if (userRole === 'parent') {
        setNextDoseFor(medId)
        setNextDoseHours('')
      }
    } catch {
      await failed("Couldn't log the dose")
      return
    }
    load()
  }

  async function setNextDose(med: Medication) {
    const hours = Number(nextDoseHours)
    if (!med.last_dose_at || !Number.isFinite(hours) || hours < 1 || hours > 48) return
    const nextAt = new Date(new Date(med.last_dose_at).getTime() + hours * 60 * 60 * 1000)
    setSaving(true)
    try {
      const res = await fetch(`/api/medications/${med.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_dose_at: nextAt.toISOString() }),
      })
      if (!res.ok) {
        await failed("Couldn't set the next dose", res)
        return
      }
      const data = await res.json().catch(() => null)
      applyMedication(data?.medication)
      setNextDoseFor(null)
      load()
    } catch {
      await failed("Couldn't set the next dose")
    } finally {
      setSaving(false)
    }
  }

  function getLatestTemp(log: TemperatureEntry[] | null): string {
    if (!log || log.length === 0) return '—'
    const latest = log[log.length - 1]
    return `${latest.value}°${latest.unit}`
  }

  function daysSince(iso: string): number {
    const start = new Date(iso)
    const now = new Date()
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  }

  const isParent = userRole === 'parent'
  // D1 (#102): a teen or child sees only their own sick days and medications
  // (the API filters them), may report only themselves as sick, and may log a
  // dose of their own medication. Temperatures, ending a sick day and
  // prescriptions stay with parents.
  const reportableMembers = isParent ? members : members.filter((m) => m.id === userId)

  if (loading && !loadedOnce) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">{t('sickDays.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('sickDays.subtitle')}</p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">{t('sickDays.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('sickDays.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowStartModal(true)}
          className="btn-tinted"
        >
          <Plus className="w-4 h-4" />
          <span>{t('sickDays.startSickDay')}</span>
        </button>
      </div>

      {/* Active sickness list */}
      {loadFailed ? (
        <div role="alert" className="card-apple p-6 text-center space-y-3">
          <p className="text-subhead text-label-primary">Couldn&apos;t load sick days. Check your connection and try again.</p>
          <button type="button" onClick={() => load()} className="btn-tinted">
            Try again
          </button>
        </div>
      ) : sickDays.length === 0 ? (
        <EmptyState
          icon={Thermometer}
          glyphColor="family"
          title={t('sickDays.empty')}
          description={t('sickDays.emptySubtitle')}
        />
      ) : (
        <section>
          <SectionHeader>{t('sickDays.activeSickness')}</SectionHeader>
          <InsetList>
            {sickDays.map((sd, i) => (
              <div key={sd.id} className={i < sickDays.length - 1 ? 'border-b border-[var(--surface-separator)]' : ''}>
                <ListRow
                  icon={Thermometer}
                  glyphColor="family"
                  title={sd.person_name}
                  subtitle={`${t(`sickDays.severity.${sd.severity}`)} · ${daysSince(sd.started_at)} ${t('sickDays.daysSince')}`}
                  trailing={
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={sd.severity} />
                      {sd.temperature_log && sd.temperature_log.length > 0 && (
                        <span className="text-caption-1 text-label-secondary">{getLatestTemp(sd.temperature_log)}</span>
                      )}
                    </div>
                  }
                  onClick={() => setSelectedId(sd.id)}
                />
              </div>
            ))}
          </InsetList>
        </section>
      )}

      {/* Start sick day */}
      <Dialog open={showStartModal} onClose={() => setShowStartModal(false)} title={t('sickDays.startSickDay')}>
        <form onSubmit={startSickDay}>
          <div className="space-y-4">
            <FormField label={t('sickDays.person')}>
              {(id) => (
                <select
                  id={id}
                  value={startForm.person_id}
                  onChange={(e) => setStartForm({ ...startForm, person_id: e.target.value })}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('sickDays.selectPerson')}</option>
                  {reportableMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={t('sickDays.severity.label')}>
              {(id) => (
                <select
                  id={id}
                  value={startForm.severity}
                  onChange={(e) => setStartForm({ ...startForm, severity: e.target.value })}
                  className={SELECT_CLASS}
                >
                  <option value="mild">{t('sickDays.severity.mild')}</option>
                  <option value="moderate">{t('sickDays.severity.moderate')}</option>
                  <option value="severe">{t('sickDays.severity.severe')}</option>
                </select>
              )}
            </FormField>
            <FormField label={t('sickDays.symptoms')}>
              {(id) => (
                <textarea
                  id={id}
                  value={startForm.symptoms}
                  onChange={(e) => setStartForm({ ...startForm, symptoms: e.target.value })}
                  rows={3}
                  placeholder={t('sickDays.symptomsPlaceholder')}
                  className={TEXTAREA_CLASS}
                />
              )}
            </FormField>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowStartModal(false)} className="btn-plain min-h-[44px]">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving || !startForm.person_id} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Sick day detail. Hidden (not closed) while a form on top of it is open,
          so only one dialog traps focus and handles Escape at a time. */}
      {selectedSickDay && (
        <Dialog
          open={!showAddTempModal && !showAddMedModal}
          onClose={() => setSelectedId(null)}
          title={selectedSickDay.person_name}
          description={<SeverityBadge severity={selectedSickDay.severity} />}
          testId="sick-day-detail"
        >
          <div className="space-y-4">
            {/* Duration + symptoms */}
            <div className="flex items-center gap-2 text-footnote text-label-secondary">
              <Avatar name={selectedSickDay.person_name} src={selectedSickDay.person_avatar || undefined} size="sm" />
              <span>
                {daysSince(selectedSickDay.started_at)} {t('sickDays.daysSince')} · {t('sickDays.startedOn')}{' '}
                {new Date(selectedSickDay.started_at).toLocaleDateString()}
              </span>
            </div>
            {selectedSickDay.symptoms && (
              <div>
                <p className="text-caption-1 text-label-secondary">{t('sickDays.symptoms')}</p>
                <p className="text-body text-label-primary mt-0.5">{selectedSickDay.symptoms}</p>
              </div>
            )}

            {/* Temperature log */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-caption-1 text-label-secondary uppercase tracking-wide">{t('sickDays.temperatureLog')}</p>
                {isParent && (
                  <button type="button" onClick={() => setShowAddTempModal(true)} className={TEXT_ACTION_CLASS}>
                    + {t('sickDays.addTemperature')}
                  </button>
                )}
              </div>
              {selectedSickDay.temperature_log && selectedSickDay.temperature_log.length > 0 ? (
                <ul className="space-y-1" aria-label={t('sickDays.temperatureLog')}>
                  {selectedSickDay.temperature_log.map((entry, idx) => (
                    <li key={idx} className="flex items-center justify-between text-footnote">
                      <span className="text-label-secondary">{new Date(entry.at).toLocaleString()}</span>
                      <span className="text-label-primary font-medium">
                        {entry.value}°{entry.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-footnote text-label-tertiary">{t('sickDays.noTemps')}</p>
              )}
            </div>

            {/* Medications */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-caption-1 text-label-secondary uppercase tracking-wide">{t('sickDays.medications')}</p>
                {isParent && (
                  <button type="button" onClick={() => setShowAddMedModal(true)} className={TEXT_ACTION_CLASS}>
                    + {t('sickDays.addMedication')}
                  </button>
                )}
              </div>
              {selectedSickDay.medications.length > 0 ? (
                <div className="space-y-2">
                  {selectedSickDay.medications.map((med) => (
                    <div key={med.id} className="bg-[var(--surface-secondary)] rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-subhead text-label-primary font-medium">{med.name}</p>
                          <p className="text-caption-1 text-label-secondary">
                            {med.dosage} · {med.schedule}
                          </p>
                          {med.last_dose_at && (
                            <p className="text-caption-1 text-label-tertiary">
                              {t('sickDays.lastDoseAt')} {new Date(med.last_dose_at).toLocaleString()}
                            </p>
                          )}
                          {med.next_dose_at && (
                            <p className="text-caption-1 text-label-tertiary">
                              {t('sickDays.nextDoseSetFor')} {new Date(med.next_dose_at).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => markDoseTaken(med.id)}
                          className="btn-tinted min-h-[44px] shrink-0 text-subhead"
                        >
                          <Check className="w-4 h-4" aria-hidden="true" />
                          {t('sickDays.markDoseTaken')}
                        </button>
                      </div>
                      {isParent && nextDoseFor === med.id && med.last_dose_at && (
                        <form
                          className="mt-2 flex flex-wrap items-end gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            setNextDose(med)
                          }}
                        >
                          <div className="flex-1 min-w-[8rem]">
                            <label htmlFor={`next-dose-${med.id}`} className="block text-caption-1 text-label-secondary mb-1">
                              {t('sickDays.nextDoseInHours')}
                            </label>
                            <input
                              id={`next-dose-${med.id}`}
                              type="number"
                              inputMode="decimal"
                              min={1}
                              max={48}
                              step="0.5"
                              value={nextDoseHours}
                              onChange={(e) => setNextDoseHours(e.target.value)}
                              className="w-full min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-elevated)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                            />
                          </div>
                          {/* .btn-tinted has no disabled look of its own. */}
                          <button
                            type="submit"
                            disabled={saving || !nextDoseHours}
                            className="btn-tinted min-h-[44px] text-subhead disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {t('sickDays.setNextDose')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setNextDoseFor(null)}
                            className="btn-ghost min-h-[44px] text-subhead"
                          >
                            {t('sickDays.skipNextDose')}
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-footnote text-label-tertiary">{t('sickDays.noMedications')}</p>
              )}
            </div>
          </div>

          {isParent && (
            <div className="mt-4">
              <button
                type="button"
                onClick={endSickness}
                disabled={saving}
                className="w-full btn-ghost min-h-[44px] text-label-destructive disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('sickDays.endSickness')}
              </button>
            </div>
          )}
        </Dialog>
      )}

      {/* Add temperature */}
      <Dialog open={showAddTempModal} onClose={() => setShowAddTempModal(false)} title={t('sickDays.addTemperature')}>
        <form onSubmit={addTemperature}>
          <div className="flex gap-2">
            <div className="flex-1">
              <FormField label={t('sickDays.temperature')}>
                {(id) => (
                  <Input
                    id={id}
                    value={tempForm.value}
                    onChange={(v) => setTempForm({ ...tempForm, value: v })}
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    placeholder="98.6"
                  />
                )}
              </FormField>
            </div>
            <FormField label={t('sickDays.unit')}>
              {(id) => (
                <select
                  id={id}
                  value={tempForm.unit}
                  onChange={(e) => setTempForm({ ...tempForm, unit: e.target.value })}
                  className="min-h-[44px] px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="F">°F</option>
                  <option value="C">°C</option>
                </select>
              )}
            </FormField>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddTempModal(false)} className="btn-plain min-h-[44px]">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving || !tempForm.value} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Add medication */}
      <Dialog open={showAddMedModal} onClose={() => setShowAddMedModal(false)} title={t('sickDays.addMedication')}>
        <form onSubmit={addMedication}>
          <div className="space-y-4">
            <FormField label={t('sickDays.person')}>
              {(id) => (
                <select
                  id={id}
                  value={medForm.person_id}
                  onChange={(e) => setMedForm({ ...medForm, person_id: e.target.value })}
                  className={SELECT_CLASS}
                >
                  <option value="">{t('sickDays.selectPerson')}</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={t('sickDays.name')}>
              {(id) => (
                <Input
                  id={id}
                  value={medForm.name}
                  onChange={(v) => setMedForm({ ...medForm, name: v })}
                  placeholder={t('sickDays.namePlaceholder')}
                />
              )}
            </FormField>
            <FormField label={t('sickDays.dosage')}>
              {(id) => (
                <Input id={id} value={medForm.dosage} onChange={(v) => setMedForm({ ...medForm, dosage: v })} placeholder="500mg" />
              )}
            </FormField>
            <FormField label={t('sickDays.schedule')}>
              {(id) => (
                <Input
                  id={id}
                  value={medForm.schedule}
                  onChange={(v) => setMedForm({ ...medForm, schedule: v })}
                  placeholder="Twice daily"
                />
              )}
            </FormField>
            <FormField label={t('sickDays.notes')}>
              {(id) => (
                <textarea
                  id={id}
                  value={medForm.notes}
                  onChange={(e) => setMedForm({ ...medForm, notes: e.target.value })}
                  rows={2}
                  placeholder={t('sickDays.notesPlaceholder')}
                  className={TEXTAREA_CLASS}
                />
              )}
            </FormField>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddMedModal(false)} className="btn-plain min-h-[44px]">
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving || !medForm.person_id || !medForm.name || !medForm.dosage || !medForm.schedule}
              className="btn-filled"
            >
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
