'use client'

import * as React from 'react'
import { Thermometer, Plus, X, Clock, Pill, Check } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { Avatar } from '@/components/ui/avatar'
import { useTranslation } from '@/i18n'

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

function Modal({
  open,
  onClose,
  children,
}: {
  open: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-[22rem] rounded-2xl overflow-hidden bg-[var(--surface-elevated)] shadow-xl max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-caption-1 text-label-secondary mb-1">{label}</label>
      {children}
    </div>
  )
}

function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  className?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${className ?? ''}`}
    />
  )
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    mild: 'bg-green-100 text-green-700',
    moderate: 'bg-yellow-100 text-yellow-700',
    severe: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-caption-1 font-semibold ${colors[severity] ?? 'bg-gray-100 text-gray-600'}`}>
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
  const [showStartModal, setShowStartModal] = React.useState(false)
  const [selectedSickDay, setSelectedSickDay] = React.useState<SickDay | null>(null)
  const [showAddTempModal, setShowAddTempModal] = React.useState(false)
  const [showAddMedModal, setShowAddMedModal] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [userRole, setUserRole] = React.useState<string>('child')

  // Start sick day form
  const [startForm, setStartForm] = React.useState({ person_id: '', severity: 'mild', symptoms: '' })

  // Add temperature form
  const [tempForm, setTempForm] = React.useState({ value: '', unit: 'F' })

  // Add medication form
  const [medForm, setMedForm] = React.useState({ person_id: '', name: '', dosage: '', schedule: '', notes: '' })

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const [sd, fm, me] = await Promise.all([
        fetch('/api/sick-days', { cache: 'no-store' }).then((r) => r.json()),
        fetch('/api/family/members', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ members: [] })),
        fetch('/api/medications', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ medications: [] })),
      ])
      setSickDays(sd.sickDays || [])
      setMembers(fm.members || [])
      // Merge medications into sick days
      if (sd.sickDays && me.medications) {
        setSickDays(sd.sickDays.map((sd: SickDay) => ({
          ...sd,
          medications: me.medications.filter((m: Medication) => m.sick_day_id === sd.id || (!m.sick_day_id && m.person_id === sd.person_id)),
        })))
      }
    } catch {
      // keep loading false
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    load()
    // Get user role from me endpoint
    fetch('/api/auth/me').then((r) => r.json()).then((d) => {
      if (d.user?.role) setUserRole(d.user.role)
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
      }
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
        load().then(() => {
          const updated = sickDays.find((sd) => sd.id === selectedSickDay.id)
          if (updated) setSelectedSickDay({ ...updated })
        })
      }
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
        setSelectedSickDay(null)
        load()
      }
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
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  async function markDoseTaken(medId: string) {
    await fetch(`/api/medications/${medId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markDoseTaken: true }),
    })
    load()
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

  if (loading) {
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
      {sickDays.length === 0 ? (
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
                  onClick={() => setSelectedSickDay(sd)}
                />
              </div>
            ))}
          </InsetList>
        </section>
      )}

      {/* Start sick day modal */}
      <Modal open={showStartModal} onClose={() => setShowStartModal(false)}>
        <form onSubmit={startSickDay}>
          <div className="px-4 py-4 border-b border-[var(--surface-separator)] flex items-center justify-between">
            <p className="text-subhead font-semibold text-label-primary">{t('sickDays.startSickDay')}</p>
            <button type="button" onClick={() => setShowStartModal(false)} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
              <X className="w-4 h-4 text-label-secondary" />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <FormField label={t('sickDays.person')}>
              <select
                value={startForm.person_id}
                onChange={(e) => setStartForm({ ...startForm, person_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="">{t('sickDays.selectPerson')}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t('sickDays.severity.label')}>
              <select
                value={startForm.severity}
                onChange={(e) => setStartForm({ ...startForm, severity: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="mild">{t('sickDays.severity.mild')}</option>
                <option value="moderate">{t('sickDays.severity.moderate')}</option>
                <option value="severe">{t('sickDays.severity.severe')}</option>
              </select>
            </FormField>
            <FormField label={t('sickDays.symptoms')}>
              <textarea
                value={startForm.symptoms}
                onChange={(e) => setStartForm({ ...startForm, symptoms: e.target.value })}
                rows={3}
                placeholder={t('sickDays.symptomsPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
              />
            </FormField>
          </div>
          <div className="px-4 pb-4 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowStartModal(false)} className="btn-plain">
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving || !startForm.person_id} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Sick day detail modal */}
      {selectedSickDay && (
        <Modal open={true} onClose={() => setSelectedSickDay(null)}>
          <div className="px-4 py-4 border-b border-[var(--surface-separator)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Avatar name={selectedSickDay.person_name} src={selectedSickDay.person_avatar || undefined} size="sm" />
              <div>
                <p className="text-subhead font-semibold text-label-primary">{selectedSickDay.person_name}</p>
                <SeverityBadge severity={selectedSickDay.severity} />
              </div>
            </div>
            <button type="button" onClick={() => setSelectedSickDay(null)} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
              <X className="w-4 h-4 text-label-secondary" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Duration + symptoms */}
            <div className="text-footnote text-label-secondary">
              {daysSince(selectedSickDay.started_at)} {t('sickDays.daysSince')} · {t('sickDays.startedOn')} {new Date(selectedSickDay.started_at).toLocaleDateString()}
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
                <button
                  type="button"
                  onClick={() => setShowAddTempModal(true)}
                  className="text-caption-1 text-[var(--accent)] font-medium"
                >
                  + {t('sickDays.addTemperature')}
                </button>
              </div>
              {selectedSickDay.temperature_log && selectedSickDay.temperature_log.length > 0 ? (
                <div className="space-y-1">
                  {selectedSickDay.temperature_log.map((entry, idx) => (
                    <div key={idx} className="flex items-center justify-between text-footnote">
                      <span className="text-label-secondary">{new Date(entry.at).toLocaleString()}</span>
                      <span className="text-label-primary font-medium">{entry.value}°{entry.unit}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-footnote text-label-tertiary">{t('sickDays.noTemps')}</p>
              )}
            </div>

            {/* Medications */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-caption-1 text-label-secondary uppercase tracking-wide">{t('sickDays.medications')}</p>
                {isParent && (
                  <button
                    type="button"
                    onClick={() => setShowAddMedModal(true)}
                    className="text-caption-1 text-[var(--accent)] font-medium"
                  >
                    + {t('sickDays.addMedication')}
                  </button>
                )}
              </div>
              {selectedSickDay.medications.length > 0 ? (
                <div className="space-y-2">
                  {selectedSickDay.medications.map((med) => (
                    <div key={med.id} className="flex items-center justify-between bg-[var(--surface-secondary)] rounded-lg px-3 py-2">
                      <div>
                        <p className="text-subhead text-label-primary font-medium">{med.name}</p>
                        <p className="text-caption-1 text-label-secondary">{med.dosage} · {med.schedule}</p>
                        {med.next_dose_at && (
                          <p className="text-caption-1 text-label-tertiary">{t('sickDays.nextDose')}: {new Date(med.next_dose_at).toLocaleString()}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => markDoseTaken(med.id)}
                        className="btn-tinted text-caption-1"
                      >
                        <Check className="w-3 h-3" />
                        {t('sickDays.markDoseTaken')}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-footnote text-label-tertiary">{t('sickDays.noMedications')}</p>
              )}
            </div>
          </div>

          <div className="px-4 pb-4">
            <button
              type="button"
              onClick={endSickness}
              disabled={saving}
              className="w-full btn-ghost text-label-destructive"
            >
              {t('sickDays.endSickness')}
            </button>
          </div>
        </Modal>
      )}

      {/* Add temperature modal */}
      <Modal open={showAddTempModal} onClose={() => setShowAddTempModal(false)}>
        <form onSubmit={addTemperature}>
          <div className="px-4 py-4 border-b border-[var(--surface-separator)] flex items-center justify-between">
            <p className="text-subhead font-semibold text-label-primary">{t('sickDays.addTemperature')}</p>
            <button type="button" onClick={() => setShowAddTempModal(false)} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
              <X className="w-4 h-4 text-label-secondary" />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div className="flex gap-2">
              <FormField label={t('sickDays.temperature')}>
                <Input
                  value={tempForm.value}
                  onChange={(v) => setTempForm({ ...tempForm, value: v })}
                  type="number"
                  placeholder="98.6"
                  className="flex-1"
                />
              </FormField>
              <FormField label={t('sickDays.unit')}>
                <select
                  value={tempForm.unit}
                  onChange={(e) => setTempForm({ ...tempForm, unit: e.target.value })}
                  className="px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                >
                  <option value="F">°F</option>
                  <option value="C">°C</option>
                </select>
              </FormField>
            </div>
          </div>
          <div className="px-4 pb-4 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddTempModal(false)} className="btn-plain">{t('common.cancel')}</button>
            <button type="submit" disabled={saving || !tempForm.value} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add medication modal */}
      <Modal open={showAddMedModal} onClose={() => setShowAddMedModal(false)}>
        <form onSubmit={addMedication}>
          <div className="px-4 py-4 border-b border-[var(--surface-separator)] flex items-center justify-between">
            <p className="text-subhead font-semibold text-label-primary">{t('sickDays.addMedication')}</p>
            <button type="button" onClick={() => setShowAddMedModal(false)} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
              <X className="w-4 h-4 text-label-secondary" />
            </button>
          </div>
          <div className="p-4 space-y-4">
            <FormField label={t('sickDays.person')}>
              <select
                value={medForm.person_id}
                onChange={(e) => setMedForm({ ...medForm, person_id: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              >
                <option value="">{t('sickDays.selectPerson')}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </FormField>
            <FormField label={t('sickDays.name')}>
              <Input value={medForm.name} onChange={(v) => setMedForm({ ...medForm, name: v })} placeholder={t('sickDays.namePlaceholder')} />
            </FormField>
            <FormField label={t('sickDays.dosage')}>
              <Input value={medForm.dosage} onChange={(v) => setMedForm({ ...medForm, dosage: v })} placeholder="500mg" />
            </FormField>
            <FormField label={t('sickDays.schedule')}>
              <Input value={medForm.schedule} onChange={(v) => setMedForm({ ...medForm, schedule: v })} placeholder="Twice daily" />
            </FormField>
            <FormField label={t('sickDays.notes')}>
              <textarea
                value={medForm.notes}
                onChange={(e) => setMedForm({ ...medForm, notes: e.target.value })}
                rows={2}
                placeholder={t('sickDays.notesPlaceholder')}
                className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
              />
            </FormField>
          </div>
          <div className="px-4 pb-4 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowAddMedModal(false)} className="btn-plain">{t('common.cancel')}</button>
            <button type="submit" disabled={saving || !medForm.person_id || !medForm.name || !medForm.dosage || !medForm.schedule} className="btn-filled">
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
