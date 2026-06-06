'use client'

import * as React from 'react'
import { Heart, Plus, X, Pencil, Trash2, Printer } from 'lucide-react'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { FeatureGate } from '@/components/ui/feature-gate'
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

// Modal shell
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

function FormField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
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

function AddEditModal({
  mode,
  initial,
  onSave,
  onCancel,
  onDelete,
  t,
  saving,
}: {
  mode: 'add' | 'edit'
  initial?: EmergencyContact
  onSave: (data: ContactFormData) => void
  onCancel: () => void
  onDelete?: () => void
  t: (key: string) => string
  saving: boolean
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
      <div className="px-4 py-4 border-b border-[var(--surface-separator)] flex items-center justify-between">
        <p className="text-subhead font-semibold text-label-primary">
          {mode === 'add' ? t('emergency.addCard') : t('emergency.editCard')}
        </p>
        <button type="button" onClick={onCancel} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
          <X className="w-4 h-4 text-label-secondary" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <FormField label={t('emergency.personName')}>
          <Input value={form.person_name} onChange={(v) => set('person_name', v)} placeholder="e.g. Emma Johnson" />
        </FormField>
        <FormField label={t('emergency.relationship')}>
          <select
            value={form.relationship}
            onChange={(e) => set('relationship', e.target.value as ContactFormData['relationship'])}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>{t(`emergency.relationships.${r}`)}</option>
            ))}
          </select>
        </FormField>
        <FormField label={t('emergency.bloodType')}>
          <Input value={form.blood_type} onChange={(v) => set('blood_type', v)} placeholder="e.g. O+" />
        </FormField>
        <FormField label={t('emergency.allergies')}>
          <Input value={form.allergies} onChange={(v) => set('allergies', v)} placeholder="e.g. Peanuts, penicillin" />
        </FormField>
        <FormField label={t('emergency.medications')}>
          <Input value={form.medications} onChange={(v) => set('medications', v)} placeholder="e.g. Metformin 500mg" />
        </FormField>
        <FormField label={t('emergency.medicalConditions')}>
          <Input value={form.medical_conditions} onChange={(v) => set('medical_conditions', v)} placeholder="e.g. Type 1 Diabetes" />
        </FormField>
        <FormField label={t('emergency.doctorName')}>
          <Input value={form.doctor_name} onChange={(v) => set('doctor_name', v)} placeholder="e.g. Dr. Smith" />
        </FormField>
        <FormField label={t('emergency.doctorPhone')}>
          <Input value={form.doctor_phone} onChange={(v) => set('doctor_phone', v)} type="tel" placeholder="e.g. (555) 123-4567" />
        </FormField>
        <FormField label={t('emergency.dentistName')}>
          <Input value={form.dentist_name} onChange={(v) => set('dentist_name', v)} placeholder="e.g. Dr. Jones" />
        </FormField>
        <FormField label={t('emergency.dentistPhone')}>
          <Input value={form.dentist_phone} onChange={(v) => set('dentist_phone', v)} type="tel" placeholder="e.g. (555) 987-6543" />
        </FormField>
        <FormField label={t('emergency.insuranceProvider')}>
          <Input value={form.insurance_provider} onChange={(v) => set('insurance_provider', v)} placeholder="e.g. Blue Cross" />
        </FormField>
        <FormField label={t('emergency.insuranceId')}>
          <Input value={form.insurance_id} onChange={(v) => set('insurance_id', v)} placeholder="e.g. BC-123456789" />
        </FormField>
        <FormField label={t('emergency.emergencyContactName')}>
          <Input value={form.emergency_contact_name} onChange={(v) => set('emergency_contact_name', v)} placeholder="e.g. John Doe" />
        </FormField>
        <FormField label={t('emergency.emergencyContactPhone')}>
          <Input value={form.emergency_contact_phone} onChange={(v) => set('emergency_contact_phone', v)} type="tel" placeholder="e.g. (555) 321-7890" />
        </FormField>
        <FormField label={t('emergency.emergencyContactRelation')}>
          <Input value={form.emergency_contact_relation} onChange={(v) => set('emergency_contact_relation', v)} placeholder="e.g. Spouse" />
        </FormField>
        <FormField label={t('emergency.notes')}>
          <textarea
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            rows={2}
            placeholder="Additional notes..."
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
        </FormField>
      </div>
      <div className="px-4 pb-4 flex gap-2">
        {mode === 'edit' && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2 rounded-lg text-label-destructive text-subhead font-medium flex items-center gap-1.5 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
            {t('emergency.delete')}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="ml-auto px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-subhead font-semibold disabled:opacity-50"
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
  const [showAdd, setShowAdd] = React.useState(false)
  const [editContact, setEditContact] = React.useState<EmergencyContact | null>(null)
  const [saving, setSaving] = React.useState(false)

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
    try {
      if (editContact) {
        const res = await fetch(`/api/emergency-contacts/${editContact.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
        if (!res.ok) throw new Error('Failed to update')
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
      // keep modal open on error
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editContact) return
    if (!confirm(t('common.confirm') + '?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/emergency-contacts/${editContact.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setEditContact(null)
      await fetchContacts()
    } catch {
      setSaving(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const closeModal = () => {
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
          .print-card { position: fixed; left: 0; top: 0; width: 100%; }
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
                onClick={handlePrint}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--surface-fill)] text-label-primary text-subhead font-medium hover:bg-[var(--surface-fill-secondary)]"
              >
                <Printer className="w-4 h-4" />
                {t('emergency.print')}
              </button>
            )}
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-subhead font-semibold"
            >
              <Plus className="w-4 h-4" />
              {t('emergency.addCard')}
            </button>
          </div>
        </div>

        {contacts.length === 0 ? (
          <div className="card-apple p-8 text-center">
            <Heart className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
            <h3 className="text-title-3 text-label-primary">{t('emergency.empty')}</h3>
            <p className="text-subhead text-label-secondary mt-1">{t('emergency.emptySubtitle')}</p>
            <button
              onClick={() => setShowAdd(true)}
              className="mt-4 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-subhead font-semibold"
            >
              {t('emergency.addCard')}
            </button>
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
                    trailing={
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditContact(c) }}
                        className="p-1 rounded-full hover:bg-[var(--surface-secondary)]"
                      >
                        <Pencil className="w-3.5 h-3.5 text-label-tertiary" />
                      </button>
                    }
                    showChevron={false}
                    last={i === contacts.length - 1}
                    onClick={() => setEditContact(c)}
                  />
                ))}
              </InsetList>
            </div>

            {/* Right: active card preview */}
            <div className="print-card">
              {editContact ? (
                <div className="card-apple overflow-hidden">
                  <div className="px-4 py-3 border-b border-[var(--surface-separator)] flex items-center justify-between no-print">
                    <p className="text-subhead font-semibold text-label-primary">{editContact.person_name}</p>
                    <button
                      onClick={() => setEditContact(null)}
                      className="p-1 rounded-full hover:bg-[var(--surface-secondary)]"
                    >
                      <X className="w-4 h-4 text-label-secondary" />
                    </button>
                  </div>
                  <EmergencyCardPrint contact={editContact} t={t} />
                  <div className="px-4 py-3 border-t border-[var(--surface-separator)] flex gap-2 no-print">
                    <button
                      onClick={() => { setEditContact(null); setShowAdd(true) }}
                      className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-white text-subhead font-semibold"
                    >
                      {t('emergency.editCard')}
                    </button>
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
                <div className="card-apple p-8 text-center">
                  <Heart className="w-8 h-8 text-label-tertiary mx-auto mb-2" />
                  <p className="text-subhead text-label-secondary">Select a card to preview</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add modal */}
        <Modal open={showAdd && !editContact} onClose={closeModal}>
          <AddEditModal
            mode="add"
            onSave={handleSave}
            onCancel={closeModal}
            t={t}
            saving={saving}
          />
        </Modal>

        {/* Edit modal */}
        <Modal open={!!editContact} onClose={() => setEditContact(null)}>
          {editContact && (
            <AddEditModal
              mode="edit"
              initial={editContact}
              onSave={handleSave}
              onCancel={() => setEditContact(null)}
              onDelete={handleDelete}
              t={t}
              saving={saving}
            />
          )}
        </Modal>
      </div>
    </>
  )
}
