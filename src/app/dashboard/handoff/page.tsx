'use client'

import * as React from 'react'
import { Plus, Pencil, Trash2, Printer, Link2, X } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { useTranslation } from '@/i18n'

interface Handoff {
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
  share_token: string
  share_expires_at: string | null
  created_at: string
}

interface HandoffFormData {
  sitter_name: string
  sitter_phone: string
  arrival_time: string
  departure_time: string
  kids_bedtimes: string
  where_snacks: string
  pickup_authorized: string
  code_words: string
  pet_care: string
  emergency_notes: string
  house_notes: string
  general_notes: string
}

function emptyForm(): HandoffFormData {
  return {
    sitter_name: '',
    sitter_phone: '',
    arrival_time: '',
    departure_time: '',
    kids_bedtimes: '',
    where_snacks: '',
    pickup_authorized: '',
    code_words: '',
    pet_care: '',
    emergency_notes: '',
    house_notes: '',
    general_notes: '',
  }
}

function handoffToForm(h: Handoff): HandoffFormData {
  return {
    sitter_name: h.sitter_name,
    sitter_phone: h.sitter_phone ?? '',
    arrival_time: h.arrival_time ? h.arrival_time.slice(0, 16) : '',
    departure_time: h.departure_time ? h.departure_time.slice(0, 16) : '',
    kids_bedtimes: h.kids_bedtimes ?? '',
    where_snacks: h.where_snacks ?? '',
    pickup_authorized: h.pickup_authorized ?? '',
    code_words: h.code_words ?? '',
    pet_care: h.pet_care ?? '',
    emergency_notes: h.emergency_notes ?? '',
    house_notes: h.house_notes ?? '',
    general_notes: h.general_notes ?? '',
  }
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

function Textarea({
  value,
  onChange,
  placeholder,
  rows = 2,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
    />
  )
}

function HandoffModal({
  mode,
  initial,
  onSave,
  onCancel,
  onDelete,
  t,
  saving,
}: {
  mode: 'add' | 'edit'
  initial?: Handoff
  onSave: (data: HandoffFormData) => void
  onCancel: () => void
  onDelete?: () => void
  t: (key: string) => string
  saving: boolean
}) {
  const [form, setForm] = React.useState<HandoffFormData>(
    initial ? handoffToForm(initial) : emptyForm()
  )

  const set = (key: keyof HandoffFormData, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="px-4 py-4 border-b border-[var(--surface-separator)] flex items-center justify-between">
        <p className="text-subhead font-semibold text-label-primary">
          {mode === 'add' ? t('handoff.createHandoff') : t('handoff.editHandoff')}
        </p>
        <button type="button" onClick={onCancel} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
          <X className="w-4 h-4 text-label-secondary" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <FormField label={t('handoff.sitterName')}>
          <Input value={form.sitter_name} onChange={(v) => set('sitter_name', v)} placeholder="e.g. Sarah" />
        </FormField>
        <FormField label={t('handoff.sitterPhone')}>
          <Input value={form.sitter_phone} onChange={(v) => set('sitter_phone', v)} type="tel" placeholder="(555) 123-4567" />
        </FormField>
        <FormField label={t('handoff.arrivalTime')}>
          <Input value={form.arrival_time} onChange={(v) => set('arrival_time', v)} type="datetime-local" />
        </FormField>
        <FormField label={t('handoff.departureTime')}>
          <Input value={form.departure_time} onChange={(v) => set('departure_time', v)} type="datetime-local" />
        </FormField>
        <FormField label={t('handoff.kidsBedtimes')}>
          <Textarea value={form.kids_bedtimes} onChange={(v) => set('kids_bedtimes', v)} placeholder="e.g. Emma: 8pm, Max: 8:30pm" rows={2} />
        </FormField>
        <FormField label={t('handoff.whereSnacks')}>
          <Textarea value={form.where_snacks} onChange={(v) => set('where_snacks', v)} placeholder="e.g. Snacks in the pantry, fruit in the fridge" rows={2} />
        </FormField>
        <FormField label={t('handoff.pickupAuthorized')}>
          <Textarea value={form.pickup_authorized} onChange={(v) => set('pickup_authorized', v)} placeholder="e.g. Grandma Jane, Uncle Bob" rows={2} />
        </FormField>
        <FormField label={t('handoff.codeWords')}>
          <Textarea value={form.code_words} onChange={(v) => set('code_words', v)} placeholder="e.g. Code word for emergencies: PINEAPPLE" rows={2} />
        </FormField>
        <FormField label={t('handoff.petCare')}>
          <Textarea value={form.pet_care} onChange={(v) => set('pet_care', v)} placeholder="e.g. Dog: walk at 7pm, cat: no special care" rows={2} />
        </FormField>
        <FormField label={t('handoff.emergencyNotes')}>
          <Textarea value={form.emergency_notes} onChange={(v) => set('emergency_notes', v)} placeholder="Allergies, medical info, emergency contacts..." rows={3} />
        </FormField>
        <FormField label={t('handoff.houseNotes')}>
          <Textarea value={form.house_notes} onChange={(v) => set('house_notes', v)} placeholder="e.g. Thermostat, TV codes, alarm code..." rows={3} />
        </FormField>
        <FormField label={t('handoff.generalNotes')}>
          <Textarea value={form.general_notes} onChange={(v) => set('general_notes', v)} placeholder="Any other notes for the sitter..." rows={3} />
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
            {t('handoff.deleteHandoff')}
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

function HandoffCard({
  handoff,
  onEdit,
  onShare,
  onPrint,
  t,
}: {
  handoff: Handoff
  onEdit: () => void
  onShare: () => void
  onPrint: () => void
  t: (key: string) => string
}) {
  return (
    <div className="card-apple overflow-hidden">
      <div className="p-4 border-b border-[var(--surface-separator)]">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-headline font-semibold text-label-primary">{handoff.sitter_name}</h3>
            {handoff.sitter_phone && (
              <p className="text-subhead text-label-secondary mt-0.5">{handoff.sitter_phone}</p>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={onShare}
              className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] text-label-secondary"
              title={t('handoff.shareWithSitter')}
            >
              <Link2 className="w-4 h-4" />
            </button>
            <button
              onClick={onPrint}
              className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] text-label-secondary"
              title={t('handoff.print')}
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              onClick={onEdit}
              className="p-2 rounded-lg hover:bg-[var(--surface-secondary)] text-label-secondary"
              title={t('handoff.editHandoff')}
            >
              <Pencil className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-2 text-footnote">
        {handoff.arrival_time && (
          <div>
            <span className="text-label-tertiary">{t('handoff.arrivalTime')}: </span>
            <span className="text-label-primary font-medium">{new Date(handoff.arrival_time).toLocaleString()}</span>
          </div>
        )}
        {handoff.departure_time && (
          <div>
            <span className="text-label-tertiary">{t('handoff.departureTime')}: </span>
            <span className="text-label-primary font-medium">{new Date(handoff.departure_time).toLocaleString()}</span>
          </div>
        )}
        {handoff.kids_bedtimes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.kidsBedtimes')}: </span>
            <span className="text-label-primary font-medium">{handoff.kids_bedtimes}</span>
          </div>
        )}
        {handoff.where_snacks && (
          <div>
            <span className="text-label-tertiary">{t('handoff.whereSnacks')}: </span>
            <span className="text-label-primary font-medium">{handoff.where_snacks}</span>
          </div>
        )}
        {handoff.pickup_authorized && (
          <div>
            <span className="text-label-tertiary">{t('handoff.pickupAuthorized')}: </span>
            <span className="text-label-primary font-medium">{handoff.pickup_authorized}</span>
          </div>
        )}
        {handoff.code_words && (
          <div>
            <span className="text-label-tertiary">{t('handoff.codeWords')}: </span>
            <span className="text-label-primary font-medium">{handoff.code_words}</span>
          </div>
        )}
        {handoff.pet_care && (
          <div>
            <span className="text-label-tertiary">{t('handoff.petCare')}: </span>
            <span className="text-label-primary font-medium">{handoff.pet_care}</span>
          </div>
        )}
        {handoff.emergency_notes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.emergencyNotes')}: </span>
            <span className="text-label-primary font-medium">{handoff.emergency_notes}</span>
          </div>
        )}
        {handoff.house_notes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.houseNotes')}: </span>
            <span className="text-label-primary font-medium">{handoff.house_notes}</span>
          </div>
        )}
        {handoff.general_notes && (
          <div>
            <span className="text-label-tertiary">{t('handoff.generalNotes')}: </span>
            <span className="text-label-primary font-medium">{handoff.general_notes}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function HandoffPage() {
  return (
    <FeatureGate featureKey="handoff">
      <HandoffPageInner />
    </FeatureGate>
  )
}

function HandoffPageInner() {
  const { t } = useTranslation()
  const [handoffs, setHandoffs] = React.useState<Handoff[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [showAdd, setShowAdd] = React.useState(false)
  const [editHandoff, setEditHandoff] = React.useState<Handoff | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [userRole, setUserRole] = React.useState<string | null>(null)

  const fetchHandoffs = React.useCallback(async () => {
    try {
      const res = await fetch('/api/handoff')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setHandoffs(data.handoffs || [])
      setError(null)
    } catch {
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  // Get user role
  React.useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setUserRole(d.user.role)
      })
      .catch(() => {})
  }, [])

  React.useEffect(() => {
    fetchHandoffs()
  }, [fetchHandoffs])

  const handleSave = async (form: HandoffFormData) => {
    setSaving(true)
    try {
      const payload = {
        ...form,
        arrival_time: form.arrival_time || null,
        departure_time: form.departure_time || null,
      }
      if (editHandoff) {
        const res = await fetch(`/api/handoff/${editHandoff.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to update')
      } else {
        const res = await fetch('/api/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to create')
      }
      setShowAdd(false)
      setEditHandoff(null)
      await fetchHandoffs()
    } catch {
      // keep modal open
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editHandoff) return
    if (!confirm(t('common.confirm') + '?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/handoff/${editHandoff.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setEditHandoff(null)
      await fetchHandoffs()
    } catch {
      setSaving(false)
    }
  }

  const handleShare = async (handoff: Handoff) => {
    try {
      const res = await fetch(`/api/handoff/${handoff.id}/regenerate-token`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to regenerate')
      const data = await res.json()
      const token = data.handoff.share_token
      const url = `${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/handoff/${token}`
      await navigator.clipboard.writeText(url)
      alert(t('handoff.linkCopied') + ': ' + url)
    } catch {
      alert(t('common.error'))
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const closeModal = () => {
    setShowAdd(false)
    setEditHandoff(null)
  }

  const isParent = userRole === 'parent'

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">{t('handoff.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('handoff.subtitle')}</p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-secondary">{t('common.loading')}</p>
        </div>
      </div>
    )
  }

  return (
    <>
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
            <h1 className="text-large-title font-display">{t('handoff.title')}</h1>
            <p className="text-subhead text-label-secondary mt-0.5">{t('handoff.subtitle')}</p>
          </div>
          {isParent && (
            <button
              onClick={() => setShowAdd(true)}
              className="btn-filled px-4 py-2 rounded-lg text-subhead font-semibold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              {t('handoff.createHandoff')}
            </button>
          )}
        </div>

        {error && (
          <div className="card-apple p-4 text-center text-label-secondary">
            {t('handoff.errorLoad')}
          </div>
        )}

        {!error && handoffs.length === 0 && (
          <EmptyState
            glyphColor="family"
            title={t('handoff.empty')}
            description={t('handoff.emptySubtitle')}
            action={
              isParent ? (
                <button
                  onClick={() => setShowAdd(true)}
                  className="btn-filled px-4 py-2 rounded-lg text-subhead font-semibold inline-flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4" />
                  {t('handoff.createHandoff')}
                </button>
              ) : undefined
            }
          />
        )}

        <div className="space-y-4">
          {handoffs.map((h) => (
            <HandoffCard
              key={h.id}
              handoff={h}
              onEdit={() => setEditHandoff(h)}
              onShare={() => handleShare(h)}
              onPrint={handlePrint}
              t={t}
            />
          ))}
        </div>
      </div>

      {/* Add modal */}
      <Modal open={showAdd} onClose={closeModal}>
        <HandoffModal
          mode="add"
          onSave={handleSave}
          onCancel={closeModal}
          t={t}
          saving={saving}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editHandoff} onClose={closeModal}>
        {editHandoff && (
          <HandoffModal
            mode="edit"
            initial={editHandoff}
            onSave={handleSave}
            onCancel={closeModal}
            onDelete={handleDelete}
            t={t}
            saving={saving}
          />
        )}
      </Modal>
    </>
  )
}
