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

type UserRole = 'parent' | 'teen' | 'child'

type MedicationRecord = Omit<Medication, 'sick_day_id' | 'person_id'> & {
  sick_day_id?: string | null
  person_id?: string
}

type SickDayRecord = Omit<SickDay, 'medications'> & { medications: MedicationRecord[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isTemperatureEntry(value: unknown): value is TemperatureEntry {
  return isRecord(value) && typeof value.value === 'number' && Number.isFinite(value.value) && typeof value.unit === 'string' && typeof value.at === 'string'
}

function isTemperatureLog(value: unknown): value is TemperatureEntry[] | null {
  return value === null || (Array.isArray(value) && value.every(isTemperatureEntry))
}

function isMedicationRecord(value: unknown): value is MedicationRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.dosage === 'string' &&
    typeof value.schedule === 'string' &&
    isNullableString(value.next_dose_at) &&
    isNullableString(value.last_dose_at) &&
    typeof value.active === 'boolean' &&
    isNullableString(value.notes) &&
    (!('sick_day_id' in value) || isNullableString(value.sick_day_id)) &&
    (!('person_id' in value) || typeof value.person_id === 'string')
  )
}

function isMedication(value: unknown): value is Medication {
  return isMedicationRecord(value) && typeof value.person_id === 'string' && isNullableString(value.sick_day_id)
}

function isSickDayRecord(value: unknown): value is SickDayRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.person_id === 'string' &&
    typeof value.person_name === 'string' &&
    isNullableString(value.person_avatar) &&
    typeof value.started_at === 'string' &&
    isNullableString(value.ended_at) &&
    isNullableString(value.symptoms) &&
    typeof value.severity === 'string' &&
    typeof value.status === 'string' &&
    isTemperatureLog(value.temperature_log) &&
    isNullableString(value.notes) &&
    Array.isArray(value.medications) &&
    value.medications.every(isMedicationRecord)
  )
}

function isFamilyMember(value: unknown): value is FamilyMember {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (!('avatar_url' in value) || isNullableString(value.avatar_url))
  )
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'parent' || value === 'teen' || value === 'child'
}

function parseArrayPayload<T>(payload: unknown, key: string, itemGuard: (value: unknown) => value is T): T[] {
  if (!isRecord(payload) || !Array.isArray(payload[key]) || !payload[key].every(itemGuard)) {
    throw new Error(`Invalid ${key} response`)
  }
  return payload[key]
}

function normalizeSickDays(records: SickDayRecord[]): SickDay[] {
  return records.map((day) => ({
    ...day,
    medications: day.medications.map((medication) => ({
      ...medication,
      sick_day_id: medication.sick_day_id ?? day.id,
      person_id: medication.person_id ?? day.person_id,
    })),
  }))
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

function SeverityBadge({ severity, label }: { severity: string; label?: string }) {
  const colors: Record<string, string> = {
    mild: 'bg-[var(--success-tint)] text-success-text',
    moderate: 'bg-[var(--warning-tint)] text-warning-text',
    severe: 'bg-[var(--danger-tint)] text-danger-text',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-caption-1 font-semibold ${colors[severity] ?? 'bg-muted text-muted-foreground'}`}>
      {label ?? severity}
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
  const { t, locale } = useTranslation()
  const [sickDays, setSickDays] = React.useState<SickDay[]>([])
  const [members, setMembers] = React.useState<FamilyMember[]>([])
  const [loading, setLoading] = React.useState(true)
  // Only the first load replaces the page with "Loading"; later reloads keep
  // the list and any open sheet on screen.
  const [loadedOnce, setLoadedOnce] = React.useState(false)
  // The list could not be loaded: show that, not "no sick days".
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [membersLoadFailed, setMembersLoadFailed] = React.useState(false)
  const [medicationsLoadFailed, setMedicationsLoadFailed] = React.useState(false)
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
  const savingRef = React.useRef(false)
  const pendingDoseIdsRef = React.useRef(new Set<string>())
  const [pendingDoseIds, setPendingDoseIds] = React.useState<Set<string>>(new Set())
  // Authority starts unknown. No write control is offered until /api/auth/me
  // returns a valid role and id for this session.
  const [userRole, setUserRole] = React.useState<UserRole | null>(null)
  const [userId, setUserId] = React.useState<string | null>(null)
  const [authLoading, setAuthLoading] = React.useState(true)
  const [authLoadFailed, setAuthLoadFailed] = React.useState(false)
  const loadSequenceRef = React.useRef(0)
  const authSequenceRef = React.useRef(0)

  const startFormId = 'sick-day-start-form'
  const tempFormId = 'sick-day-temperature-form'
  const medFormId = 'sick-day-medication-form'

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

  const beginMutation = React.useCallback(() => {
    if (savingRef.current) return false
    savingRef.current = true
    setSaving(true)
    return true
  }, [])

  const finishMutation = React.useCallback(() => {
    savingRef.current = false
    setSaving(false)
  }, [])

  const jsonOrThrow = React.useCallback(async (url: string) => {
    const response = await fetch(url, { cache: 'no-store' })
    if (!response.ok) throw new Error(`${url} returned ${response.status}`)
    return response.json()
  }, [])

  const load = React.useCallback(async () => {
    const requestId = ++loadSequenceRef.current
    setLoading(true)
    try {
      const [sickDaysResult, membersResult, medicationsResult] = await Promise.allSettled([
        jsonOrThrow('/api/sick-days'),
        jsonOrThrow('/api/family/members'),
        jsonOrThrow('/api/medications'),
      ])

      // A retry can begin before an older read settles. Only the newest
      // request may replace visible records or finish the loading state.
      if (requestId !== loadSequenceRef.current) return

      if (sickDaysResult.status === 'rejected') {
        setLoadFailed(true)
        return
      }

      let nextSickDays: SickDay[]
      try {
        nextSickDays = normalizeSickDays(parseArrayPayload(sickDaysResult.value, 'sickDays', isSickDayRecord))
      } catch {
        setLoadFailed(true)
        return
      }

      setLoadFailed(false)
      if (membersResult.status === 'fulfilled') {
        try {
          setMembers(parseArrayPayload(membersResult.value, 'members', isFamilyMember))
          setMembersLoadFailed(false)
        } catch {
          setMembersLoadFailed(true)
        }
      } else {
        setMembersLoadFailed(true)
      }

      let medicationPayload: Medication[] | null = null
      if (medicationsResult.status === 'fulfilled') {
        try {
          medicationPayload = parseArrayPayload(medicationsResult.value, 'medications', isMedication)
          setMedicationsLoadFailed(false)
        } catch {
          setMedicationsLoadFailed(true)
        }
      } else {
        setMedicationsLoadFailed(true)
      }

      // Keep medication records embedded in the sick-day response visible while
      // the separate active-medication request is unavailable or malformed.
      setSickDays(
        nextSickDays.map((day) => ({
          ...day,
          medications: medicationPayload
            ? medicationPayload.filter(
                (m) => m.sick_day_id === day.id || (!m.sick_day_id && m.person_id === day.person_id)
              )
            : day.medications,
        }))
      )
    } catch {
      // Promise.allSettled normally contains request/JSON errors, but keep the
      // page truthful if validation or a future parser change throws here.
      if (requestId === loadSequenceRef.current) setLoadFailed(true)
    } finally {
      if (requestId === loadSequenceRef.current) {
        setLoading(false)
        setLoadedOnce(true)
      }
    }
  }, [jsonOrThrow])

  const loadAuth = React.useCallback(async () => {
    const requestId = ++authSequenceRef.current
    setAuthLoading(true)
    setAuthLoadFailed(false)
    setUserRole(null)
    setUserId(null)
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' })
      if (!response.ok) throw new Error(`/api/auth/me returned ${response.status}`)
      const payload: unknown = await response.json()
      const user = isRecord(payload) && isRecord(payload.user) ? payload.user : null
      if (!user || typeof user.id !== 'string' || !user.id || !isUserRole(user.role)) {
        throw new Error('Invalid /api/auth/me response')
      }
      if (requestId !== authSequenceRef.current) return
      setUserId(user.id)
      setUserRole(user.role)
      setAuthLoadFailed(false)
    } catch {
      if (requestId === authSequenceRef.current) {
        setUserRole(null)
        setUserId(null)
        setAuthLoadFailed(true)
      }
    } finally {
      if (requestId === authSequenceRef.current) setAuthLoading(false)
    }
  }, [])

  const authorityReady = !authLoading && !authLoadFailed && userRole !== null && userId !== null
  const isParent = authorityReady && userRole === 'parent'
  const reportableMembers = authorityReady
    ? isParent
      ? members
      : members.filter((m) => m.id === userId)
    : []

  // KidHome pattern: a refused or failed request says so in a toast instead
  // of doing nothing (or leaving an unhandled rejection when offline).
  const failed = React.useCallback(
    async (title: string, res?: Response) => {
      addToast({ type: 'error', title, message: res ? await responseErrorMessage(res) : OFFLINE_MESSAGE })
    },
    [addToast]
  )

  React.useEffect(() => {
    void load()
    void loadAuth()
  }, [load, loadAuth])

  async function startSickDay(e: React.FormEvent) {
    e.preventDefault()
    if (!authorityReady || !startForm.person_id || !startForm.severity) return
    if (!beginMutation()) return
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
        await failed(t('sickDays.startFailed'), res)
      }
    } catch {
      await failed(t('sickDays.startFailed'))
    } finally {
      finishMutation()
    }
  }

  async function addTemperature(e: React.FormEvent) {
    e.preventDefault()
    if (!authorityReady || !selectedSickDay || !tempForm.value) return
    if (!beginMutation()) return
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
        await failed(t('sickDays.temperatureFailed'), res)
      }
    } catch {
      await failed(t('sickDays.temperatureFailed'))
    } finally {
      finishMutation()
    }
  }

  async function endSickness() {
    if (!authorityReady || !selectedSickDay) return
    if (!beginMutation()) return
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
        await failed(t('sickDays.endFailed'), res)
      }
    } catch {
      await failed(t('sickDays.endFailed'))
    } finally {
      finishMutation()
    }
  }

  async function addMedication(e: React.FormEvent) {
    e.preventDefault()
    if (!authorityReady || !medForm.person_id || !medForm.name || !medForm.dosage || !medForm.schedule) return
    if (!beginMutation()) return
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
        await failed(t('sickDays.medicationFailed'), res)
      }
    } catch {
      await failed(t('sickDays.medicationFailed'))
    } finally {
      finishMutation()
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
    if (!authorityReady || savingRef.current || pendingDoseIdsRef.current.has(medId)) return
    pendingDoseIdsRef.current.add(medId)
    setPendingDoseIds(new Set(pendingDoseIdsRef.current))
    try {
      const res = await fetch(`/api/medications/${medId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markDoseTaken: true }),
      })
      if (!res.ok) {
        await failed(t('sickDays.doseFailed'), res)
        return
      }
      const data = await res.json().catch(() => null)
      applyMedication(data?.medication)
      if (userRole === 'parent') {
        setNextDoseFor(medId)
        setNextDoseHours('')
      }
      await load()
    } catch {
      await failed(t('sickDays.doseFailed'))
      return
    } finally {
      pendingDoseIdsRef.current.delete(medId)
      setPendingDoseIds(new Set(pendingDoseIdsRef.current))
    }
  }

  async function setNextDose(med: Medication) {
    const hours = Number(nextDoseHours)
    if (!authorityReady || !med.last_dose_at || !Number.isFinite(hours) || hours < 1 || hours > 48) return
    if (pendingDoseIdsRef.current.has(med.id) || !beginMutation()) return
    const nextAt = new Date(new Date(med.last_dose_at).getTime() + hours * 60 * 60 * 1000)
    try {
      const res = await fetch(`/api/medications/${med.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next_dose_at: nextAt.toISOString() }),
      })
      if (!res.ok) {
        await failed(t('sickDays.nextDoseFailed'), res)
        return
      }
      const data = await res.json().catch(() => null)
      applyMedication(data?.medication)
      setNextDoseFor(null)
      load()
    } catch {
      await failed(t('sickDays.nextDoseFailed'))
    } finally {
      finishMutation()
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

  // D1 (#102): a teen or child sees only their own sick days and medications
  // (the API filters them), may report only themselves as sick, and may log a
  // dose of their own medication. Temperatures, ending a sick day and
  // prescriptions stay with parents.
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
        {authorityReady && (
          <button
            type="button"
            onClick={() => setShowStartModal(true)}
            className="btn-tinted"
          >
            <Plus className="w-4 h-4" />
            <span>{t('sickDays.startSickDay')}</span>
          </button>
        )}
      </div>

      {authLoadFailed && (
        <div role="alert" className="card-apple p-4 text-center space-y-2">
          <p className="text-footnote text-label-primary">{t('sickDays.authLoadFailed')}</p>
          <button type="button" onClick={() => void loadAuth()} className="btn-plain min-h-[44px]">
            {t('sickDays.tryAgain')}
          </button>
        </div>
      )}

      {/* Active sickness list */}
      {loadFailed ? (
        <div role="alert" className="card-apple p-6 text-center space-y-3">
          <p className="text-subhead text-label-primary">{t('sickDays.loadFailed')}</p>
          <button type="button" onClick={() => void load()} className="btn-tinted">
            {t('sickDays.tryAgain')}
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
                      <SeverityBadge severity={sd.severity} label={t(`sickDays.severity.${sd.severity}`)} />
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

      {medicationsLoadFailed && (
        <div role="alert" className="card-apple p-4 text-center space-y-2">
          <p className="text-footnote text-label-primary">{t('sickDays.medicationsLoadFailed')}</p>
          <button type="button" onClick={() => void load()} className="btn-plain min-h-[44px]">
            {t('sickDays.tryAgain')}
          </button>
        </div>
      )}
      {membersLoadFailed && (
        <div role="alert" className="card-apple p-4 text-center space-y-2">
          <p className="text-footnote text-label-primary">{t('sickDays.membersLoadFailed')}</p>
          <button type="button" onClick={() => void load()} className="btn-plain min-h-[44px]">
            {t('sickDays.tryAgain')}
          </button>
        </div>
      )}

      {/* Start sick day */}
      <Dialog
        open={showStartModal && authorityReady}
        onClose={saving || !authorityReady ? undefined : () => setShowStartModal(false)}
        closeLabel={t('sickDays.closeForm')}
        title={t('sickDays.startSickDay')}
        description={saving ? t('sickDays.pendingDescription') : t('sickDays.draftDescription')}
        variant="form"
        footer={(
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowStartModal(false)} disabled={saving} className="btn-plain min-h-[44px] disabled:opacity-40">
              {t('common.cancel')}
            </button>
            <button type="submit" form={startFormId} disabled={saving || !authorityReady || !startForm.person_id} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      >
        <form id={startFormId} onSubmit={startSickDay} aria-busy={saving}>
          <fieldset disabled={saving || !authorityReady} className="space-y-4">
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
          </fieldset>
        </form>
      </Dialog>

      {/* Sick day detail. Hidden (not closed) while a form on top of it is open,
          so only one dialog traps focus and handles Escape at a time. */}
      {selectedSickDay && (
        <Dialog
          open={!showAddTempModal && !showAddMedModal}
          onClose={saving ? undefined : () => setSelectedId(null)}
          closeLabel={t('sickDays.closeDetails')}
          title={selectedSickDay.person_name}
          description={<SeverityBadge severity={selectedSickDay.severity} label={t(`sickDays.severity.${selectedSickDay.severity}`)} />}
          testId="sick-day-detail"
        >
          <div className="space-y-4">
            {/* Duration + symptoms */}
            <div className="flex items-center gap-2 text-footnote text-label-secondary">
              <Avatar name={selectedSickDay.person_name} src={selectedSickDay.person_avatar || undefined} size="sm" />
              <span>
                {daysSince(selectedSickDay.started_at)} {t('sickDays.daysSince')} · {t('sickDays.startedOn')}{' '}
                {new Date(selectedSickDay.started_at).toLocaleDateString(locale)}
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
                      <span className="text-label-secondary">{new Date(entry.at).toLocaleString(locale)}</span>
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
                              {t('sickDays.lastDoseAt')} {new Date(med.last_dose_at).toLocaleString(locale)}
                            </p>
                          )}
                          {med.next_dose_at && (
                            <p className="text-caption-1 text-label-tertiary">
                              {t('sickDays.nextDoseSetFor')} {new Date(med.next_dose_at).toLocaleString(locale)}
                            </p>
                          )}
                        </div>
                        {authorityReady && (
                          <button
                            type="button"
                            onClick={() => markDoseTaken(med.id)}
                            disabled={saving || pendingDoseIds.has(med.id)}
                            aria-busy={pendingDoseIds.has(med.id)}
                            aria-label={`${t('sickDays.markDoseTaken')} ${med.name}`}
                            className="btn-tinted min-h-[44px] shrink-0 text-subhead disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Check className="w-4 h-4" aria-hidden="true" />
                            {t('sickDays.markDoseTaken')}
                          </button>
                        )}
                      </div>
                      {isParent && nextDoseFor === med.id && med.last_dose_at && (
                        <form
                          className="mt-2 flex flex-wrap items-end gap-2"
                          onSubmit={(e) => {
                            e.preventDefault()
                            setNextDose(med)
                          }}
                        >
                          <fieldset disabled={saving} className="contents">
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
                          </fieldset>
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
                disabled={saving || pendingDoseIds.size > 0}
                className="w-full btn-ghost min-h-[44px] text-danger-text disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('sickDays.endSickness')}
              </button>
            </div>
          )}
        </Dialog>
      )}

      {/* Add temperature */}
      <Dialog
        open={showAddTempModal && authorityReady}
        onClose={saving || !authorityReady ? undefined : () => setShowAddTempModal(false)}
        closeLabel={t('sickDays.closeForm')}
        title={t('sickDays.addTemperature')}
        description={saving ? t('sickDays.pendingDescription') : t('sickDays.draftDescription')}
        variant="form"
        footer={(
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddTempModal(false)} disabled={saving} className="btn-plain min-h-[44px] disabled:opacity-40">
              {t('common.cancel')}
            </button>
            <button type="submit" form={tempFormId} disabled={saving || !authorityReady || !tempForm.value} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      >
        <form id={tempFormId} onSubmit={addTemperature} aria-busy={saving}>
          <fieldset disabled={saving || !authorityReady} className="flex gap-2">
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
          </fieldset>
        </form>
      </Dialog>

      {/* Add medication */}
      <Dialog
        open={showAddMedModal && authorityReady}
        onClose={saving || !authorityReady ? undefined : () => setShowAddMedModal(false)}
        closeLabel={t('sickDays.closeForm')}
        title={t('sickDays.addMedication')}
        description={saving ? t('sickDays.pendingDescription') : t('sickDays.draftDescription')}
        variant="form"
        footer={(
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddMedModal(false)} disabled={saving} className="btn-plain min-h-[44px] disabled:opacity-40">
              {t('common.cancel')}
            </button>
            <button type="submit" form={medFormId} disabled={saving || !authorityReady || !medForm.person_id || !medForm.name || !medForm.dosage || !medForm.schedule} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      >
        <form id={medFormId} onSubmit={addMedication} aria-busy={saving}>
          <fieldset disabled={saving || !authorityReady} className="space-y-4">
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
                  placeholder={t('sickDays.schedulePlaceholder')}
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
          </fieldset>
        </form>
      </Dialog>
    </div>
  )
}
