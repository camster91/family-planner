'use client'

import * as React from 'react'
import { Heart, Plus, X, Trash2, Printer } from 'lucide-react'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Dialog } from '@/components/ui/dialog'
import { useTranslation } from '@/i18n'

interface EmergencyContact {
  id: string
  person_id: string | null
  person_name: string
  relationship: string
  blood_type: string | null
  allergies: string | null
  medications: string | null
  medical_conditions: string | null
  doctor_name: string | null
  doctor_phone: string | null
  dentist_name: string | null
  dentist_phone: string | null
  insurance_provider: string | null
  insurance_id: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation: string | null
  notes: string | null
}

interface ContactFormData {
  person_name: string
  relationship: 'self' | 'child' | 'spouse' | 'parent' | 'other'
  blood_type: string
  allergies: string
  medications: string
  medical_conditions: string
  doctor_name: string
  doctor_phone: string
  dentist_name: string
  dentist_phone: string
  insurance_provider: string
  insurance_id: string
  emergency_contact_name: string
  emergency_contact_phone: string
  emergency_contact_relation: string
  notes: string
}

const RELATIONSHIPS = ['self', 'child', 'spouse', 'parent', 'other'] as const

function emptyForm(): ContactFormData {
  return {
    person_name: '',
    relationship: 'self',
    blood_type: '',
    allergies: '',
    medications: '',
    medical_conditions: '',
    doctor_name: '',
    doctor_phone: '',
    dentist_name: '',
    dentist_phone: '',
    insurance_provider: '',
    insurance_id: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relation: '',
    notes: '',
  }
}

function contactToForm(c: EmergencyContact): ContactFormData {
  return {
    person_name: c.person_name,
    relationship: c.relationship as ContactFormData['relationship'],
    blood_type: c.blood_type ?? '',
    allergies: c.allergies ?? '',
    medications: c.medications ?? '',
    medical_conditions: c.medical_conditions ?? '',
    doctor_name: c.doctor_name ?? '',
    doctor_phone: c.doctor_phone ?? '',
    dentist_name: c.dentist_name ?? '',
    dentist_phone: c.dentist_phone ?? '',
    insurance_provider: c.insurance_provider ?? '',
    insurance_id: c.insurance_id ?? '',
    emergency_contact_name: c.emergency_contact_name ?? '',
    emergency_contact_phone: c.emergency_contact_phone ?? '',
    emergency_contact_relation: c.emergency_contact_relation ?? '',
    notes: c.notes ?? '',
  }
}

function FormField({
  label,
  children,
}: {
  label: string
  /** Render the control with the id the label points at. */
  children: (id: string) => React.ReactNode
}) {
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

function Input({
  id,
  value,
  onChange,
  type = 'text',
  placeholder,
  className,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  className?: string
}) {
  return (
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] ${className ?? ''}`}
    />
  )
}

function AddEditModal({
  mode,
  initial,
  onSave,
  onDelete,
  t,
  saving,
  error,
}: {
  mode: 'add' | 'edit'
  initial?: EmergencyContact
  onSave: (data: ContactFormData) => void
  onDelete?: () => void
  t: (key: string) => string
  saving: boolean
  error?: string | null
}) {
  const [form, setForm] = React.useState<ContactFormData>(
    initial ? contactToForm(initial) : emptyForm()
  )

  const set = (key: keyof ContactFormData, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-footnote text-danger-text">
            {error}
          </p>
        )}
        <FormField label={t('emergency.personName')}>
          {(id) => <Input id={id} value={form.person_name} onChange={(v) => set('person_name', v)} placeholder="e.g. Emma Johnson" />}
        </FormField>
        <FormField label={t('emergency.relationship')}>
          {(id) => (
            <select
              id={id}
              value={form.relationship}
              onChange={(e) => set('relationship', e.target.value as ContactFormData['relationship'])}
              className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>{t(`emergency.relationships.${r}`)}</option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={t('emergency.bloodType')}>
          {(id) => <Input id={id} value={form.blood_type} onChange={(v) => set('blood_type', v)} placeholder="e.g. O+" />}
        </FormField>
        <FormField label={t('emergency.allergies')}>
          {(id) => <Input id={id} value={form.allergies} onChange={(v) => set('allergies', v)} placeholder="e.g. Peanuts, penicillin" />}
        </FormField>
        <FormField label={t('emergency.medications')}>
          {(id) => <Input id={id} value={form.medications} onChange={(v) => set('medications', v)} placeholder="e.g. Metformin 500mg" />}
        </FormField>
        <FormField label={t('emergency.medicalConditions')}>
          {(id) => <Input id={id} value={form.medical_conditions} onChange={(v) => set('medical_conditions', v)} placeholder="e.g. Type 1 Diabetes" />}
        </FormField>
        <FormField label={t('emergency.doctorName')}>
          {(id) => <Input id={id} value={form.doctor_name} onChange={(v) => set('doctor_name', v)} placeholder="e.g. Dr. Smith" />}
        </FormField>
        <FormField label={t('emergency.doctorPhone')}>
          {(id) => <Input id={id} value={form.doctor_phone} onChange={(v) => set('doctor_phone', v)} type="tel" placeholder="e.g. (555) 123-4567" />}
        </FormField>
        <FormField label={t('emergency.dentistName')}>
          {(id) => <Input id={id} value={form.dentist_name} onChange={(v) => set('dentist_name', v)} placeholder="e.g. Dr. Jones" />}
        </FormField>
        <FormField label={t('emergency.dentistPhone')}>
          {(id) => <Input id={id} value={form.dentist_phone} onChange={(v) => set('dentist_phone', v)} type="tel" placeholder="e.g. (555) 987-6543" />}
        </FormField>
        <FormField label={t('emergency.insuranceProvider')}>
          {(id) => <Input id={id} value={form.insurance_provider} onChange={(v) => set('insurance_provider', v)} placeholder="e.g. Blue Cross" />}
        </FormField>
        <FormField label={t('emergency.insuranceId')}>
          {(id) => <Input id={id} value={form.insurance_id} onChange={(v) => set('insurance_id', v)} placeholder="e.g. BC-123456789" />}
        </FormField>
        <FormField label={t('emergency.emergencyContactName')}>
          {(id) => <Input id={id} value={form.emergency_contact_name} onChange={(v) => set('emergency_contact_name', v)} placeholder="e.g. John Doe" />}
        </FormField>
        <FormField label={t('emergency.emergencyContactPhone')}>
          {(id) => <Input id={id} value={form.emergency_contact_phone} onChange={(v) => set('emergency_contact_phone', v)} type="tel" placeholder="e.g. (555) 321-7890" />}
        </FormField>
        <FormField label={t('emergency.emergencyContactRelation')}>
          {(id) => <Input id={id} value={form.emergency_contact_relation} onChange={(v) => set('emergency_contact_relation', v)} placeholder="e.g. Spouse" />}
        </FormField>
        <FormField label={t('emergency.notes')}>
          {(id) => (
            <textarea
              id={id}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={2}
              placeholder="Additional notes..."
              className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
            />
          )}
        </FormField>
      </div>
      <div className="mt-6 flex gap-2">
        {mode === 'edit' && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2 rounded-lg text-danger-text text-subhead font-medium flex items-center gap-1.5 hover:bg-[var(--danger-tint)]"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {t('emergency.delete')}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="ml-auto px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </form>
  )
}

// Print card for a single contact
function EmergencyCardPrint({
  contact,
  t,
}: {
  contact: EmergencyContact
  t: (key: string) => string
}) {
  const rel = contact.relationship as ContactFormData['relationship']
  return (
    <div className="p-4 border-b border-[var(--surface-separator)] last:border-b-0">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-title-2 font-semibold text-label-primary">{contact.person_name}</h3>
          <p className="text-subhead text-label-secondary">{t(`emergency.relationships.${rel}`)}</p>
        </div>
        {contact.blood_type && (
          <span className="px-2 py-0.5 rounded-full bg-[var(--tint-family)] text-white text-caption-1 font-semibold">
            {contact.blood_type}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-footnote">
        {contact.allergies && (
          <div className="col-span-2">
            <span className="text-label-tertiary">{t('emergency.allergies')}: </span>
            <span className="text-label-primary font-medium">{contact.allergies}</span>
          </div>
        )}
        {contact.medications && (
          <div className="col-span-2">
            <span className="text-label-tertiary">{t('emergency.medications')}: </span>
            <span className="text-label-primary font-medium">{contact.medications}</span>
          </div>
        )}
        {contact.medical_conditions && (
          <div className="col-span-2">
            <span className="text-label-tertiary">{t('emergency.medicalConditions')}: </span>
            <span className="text-label-primary font-medium">{contact.medical_conditions}</span>
          </div>
        )}
        {contact.doctor_name && (
          <>
            <div>
              <span className="text-label-tertiary">{t('emergency.doctorName')}: </span>
              <span className="text-label-primary font-medium">{contact.doctor_name}</span>
            </div>
            {contact.doctor_phone && (
              <div>
                <span className="text-label-tertiary">{t('emergency.doctorPhone')}: </span>
                <span className="text-label-primary font-medium">{contact.doctor_phone}</span>
              </div>
            )}
          </>
        )}
        {contact.dentist_name && (
          <>
            <div>
              <span className="text-label-tertiary">{t('emergency.dentistName')}: </span>
              <span className="text-label-primary font-medium">{contact.dentist_name}</span>
            </div>
            {contact.dentist_phone && (
              <div>
                <span className="text-label-tertiary">{t('emergency.dentistPhone')}: </span>
                <span className="text-label-primary font-medium">{contact.dentist_phone}</span>
              </div>
            )}
          </>
        )}
        {contact.insurance_provider && (
          <>
            <div>
              <span className="text-label-tertiary">{t('emergency.insuranceProvider')}: </span>
              <span className="text-label-primary font-medium">{contact.insurance_provider}</span>
            </div>
            {contact.insurance_id && (
              <div>
                <span className="text-label-tertiary">{t('emergency.insuranceId')}: </span>
                <span className="text-label-primary font-medium">{contact.insurance_id}</span>
              </div>
            )}
          </>
        )}
        {contact.emergency_contact_name && (
          <div className="col-span-2">
            <span className="text-label-tertiary">{t('emergency.emergencyContactName')}: </span>
            <span className="text-label-primary font-medium">{contact.emergency_contact_name}</span>
            {contact.emergency_contact_relation && (
              <span className="text-label-tertiary"> ({contact.emergency_contact_relation})</span>
            )}
            {contact.emergency_contact_phone && (
              <span className="text-label-tertiary"> — {contact.emergency_contact_phone}</span>
            )}
          </div>
        )}
        {contact.notes && (
          <div className="col-span-2">
            <span className="text-label-tertiary">{t('emergency.notes')}: </span>
            <span className="text-label-primary font-medium">{contact.notes}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function EmergencyPage() {
  return (
    <FeatureGate featureKey="emergency">
      <EmergencyPageInner />
    </FeatureGate>
  )
}

function EmergencyPageInner() {
  const { t } = useTranslation()
  const [contacts, setContacts] = React.useState<EmergencyContact[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [modalError, setModalError] = React.useState<string | null>(null)
  const [showAdd, setShowAdd] = React.useState(false)
  // previewContact: the card shown on the right. editContact: the card open in the edit dialog.
  const [previewContact, setPreviewContact] = React.useState<EmergencyContact | null>(null)
  const [editContact, setEditContact] = React.useState<EmergencyContact | null>(null)
  const [saving, setSaving] = React.useState(false)
  // D1 (#102): every member can read the cards (a child home alone must find
  // them); only parents can add, edit or delete. Unknown until /api/auth/me
  // answers, so the controls stay hidden rather than flash for a child.
  const [isParent, setIsParent] = React.useState(false)

  React.useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setIsParent(d?.user?.role === 'parent'))
      .catch(() => {})
  }, [])

  const fetchContacts = React.useCallback(async () => {
    try {
      const res = await fetch('/api/emergency-contacts')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setContacts(data.contacts || [])
      setError(null)
    } catch {
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchContacts()
  }, [fetchContacts])

  const handleSave = async (form: ContactFormData) => {
    setSaving(true)
    setModalError(null)
    try {
      if (editContact) {
        const res = await fetch(`/api/emergency-contacts/${editContact.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error('Failed to update')
        const edited = editContact
        setPreviewContact((prev) => (prev && prev.id === edited.id ? { ...prev, ...form } : prev))
      } else {
        const res = await fetch('/api/emergency-contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error('Failed to create')
      }
      setShowAdd(false)
      setEditContact(null)
      await fetchContacts()
    } catch {
      // Keep the modal open and say so.
      setModalError(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editContact) return
    if (!confirm(t('common.confirm') + '?')) return
    setSaving(true)
    setModalError(null)
    try {
      const res = await fetch(`/api/emergency-contacts/${editContact.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setEditContact(null)
      setPreviewContact(null)
      await fetchContacts()
    } catch {
      setModalError(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const closeModal = () => {
    setModalError(null)
    setShowAdd(false)
    setEditContact(null)
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">{t('emergency.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('emergency.subtitle')}</p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Print-only styles */}
      <style jsx global>{`
        @media print {
          @page { margin: 0.5in; size: letter; }
          body * { visibility: hidden; }
          .print-card, .print-card * { visibility: visible; }
          .print-card { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="flex items-center justify-between no-print">
          <div>
            <h1 className="text-large-title font-display">{t('emergency.title')}</h1>
            <p className="text-subhead text-label-secondary mt-0.5">{t('emergency.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            {contacts.length > 0 && (
              <button
                type="button"
                onClick={handlePrint}
                className="flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-fill)] text-label-primary text-subhead font-medium hover:bg-[var(--surface-fill-secondary)]"
              >
                <Printer className="w-4 h-4" />
                {t('emergency.print')}
              </button>
            )}
            {isParent && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-fill)] text-white text-subhead font-semibold"
              >
                <Plus className="w-4 h-4" />
                {t('emergency.addCard')}
              </button>
            )}
          </div>
        </div>

        {contacts.length === 0 ? (
          <div className="card-apple p-8 text-center">
            <Heart className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
            <h2 className="text-title-3 text-label-primary">{t('emergency.empty')}</h2>
            <p className="text-subhead text-label-secondary mt-1">{t('emergency.emptySubtitle')}</p>
            {isParent && (
              <button
                onClick={() => setShowAdd(true)}
                className="mt-4 px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold"
              >
                {t('emergency.addCard')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: list */}
            <div className="space-y-2">
              <SectionHeader>{t('emergency.title')}</SectionHeader>
              <InsetList>
                {contacts.map((c, i) => (
                  <ListRow
                    key={c.id}
                    icon={Heart}
                    glyphColor="family"
                    title={c.person_name}
                    subtitle={t(`emergency.relationships.${c.relationship}`)}
                    showChevron
                    last={i === contacts.length - 1}
                    onClick={() => setPreviewContact(c)}
                  />
                ))}
              </InsetList>
            </div>

            {/* Right: active card preview. Print shows the previewed card, or
                every card (the print-only block below) when none is previewed. */}
            <div className={previewContact ? 'print-card' : undefined} data-testid="emergency-preview">
              {previewContact ? (
                <div className="card-apple overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--surface-separator)] flex items-center justify-between no-print">
                    <p className="text-subhead font-semibold text-label-primary">{previewContact.person_name}</p>
                    <button
                      type="button"
                      onClick={() => setPreviewContact(null)}
                      aria-label="Close preview"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[var(--surface-secondary)]"
                    >
                      <X className="w-4 h-4 text-label-secondary" aria-hidden="true" />
                    </button>
                  </div>
                  <EmergencyCardPrint contact={previewContact} t={t} />
                  <div className="px-4 py-3 border-t border-[var(--surface-separator)] flex gap-2 no-print">
                    {isParent && (
                      <button
                        onClick={() => setEditContact(previewContact)}
                        className="px-3 py-1.5 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold"
                      >
                        {t('emergency.editCard')}
                      </button>
                    )}
                    <button
                      onClick={handlePrint}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-fill)] text-label-primary text-subhead font-medium"
                    >
                      <Printer className="w-4 h-4" />
                      {t('emergency.print')}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="card-apple p-8 text-center no-print">
                  <Heart className="w-8 h-8 text-label-tertiary mx-auto mb-2" />
                  <p className="text-subhead text-label-secondary">Select a card to preview</p>
                </div>
              )}
            </div>

            {!previewContact && (
              <div className="print-card hidden print:block" data-testid="emergency-print-all">
                {contacts.map((c) => (
                  <div key={c.id} className="break-inside-avoid">
                    <EmergencyCardPrint contact={c} t={t} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add modal */}
        <Dialog
          open={isParent && showAdd && !editContact}
          onClose={closeModal}
          title={t('emergency.addCard')}
        >
          <AddEditModal mode="add" onSave={handleSave} t={t} saving={saving} error={modalError} />
        </Dialog>

        {/* Edit modal */}
        <Dialog open={isParent && !!editContact} onClose={closeModal} title={t('emergency.editCard')}>
          {isParent && editContact && (
            <AddEditModal
              mode="edit"
              initial={editContact}
              onSave={handleSave}
              onDelete={handleDelete}
              t={t}
              saving={saving}
              error={modalError}
            />
          )}
        </Dialog>
      </div>
    </>
  )
}
