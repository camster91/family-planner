'use client'

import * as React from 'react'
import { Gift, Cake, Heart, Plus, X, Pencil, Trash2 } from 'lucide-react'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { FeatureGate } from '@/components/ui/feature-gate'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

interface FamilyDate {
  id: string
  name: string
  type: 'birthday' | 'anniversary' | 'custom'
  date: string
  notes?: string | null
  person_id?: string | null
  days_until?: number
  role?: string
}

interface ApiDateItem extends FamilyDate {
  days_until: number
  next_occurrence: string
}

function getDaysUntil(dateStr: string): number {
  const now = new Date()
  const target = new Date(dateStr)
  const diff = target.getTime() - now.getTime()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function getDateSubtitle(date: FamilyDate, daysUntil: number, t: (key: string) => string): string {
  const dateStr = formatDate(date.date)
  if (daysUntil === 0) return `${dateStr} · ${t('dates.today')}`
  if (daysUntil === 1) return `${dateStr} · ${t('dates.tomorrow')}`
  return `${dateStr} · ${daysUntil}${t('dates.daysAway')}`
}

function buildDateItems(dates: ApiDateItem[]): {
  birthdays: DateItem[]
  anniversaries: DateItem[]
} {
  const withDays = dates.map(d => ({ ...d, daysUntil: d.days_until }))
  return {
    birthdays: withDays.filter(d => d.type === 'birthday').sort((a, b) => a.daysUntil - b.daysUntil),
    anniversaries: withDays.filter(d => d.type === 'anniversary').sort((a, b) => a.daysUntil - b.daysUntil),
  }
}

type DateItem = ApiDateItem & { daysUntil: number }

function DateSection({
  title,
  items,
  icon,
  glyphColor,
  onItemClick,
  t,
}: {
  title: string
  items: DateItem[]
  icon: typeof Cake
  glyphColor: 'family' | 'rewards'
  onItemClick: (item: DateItem) => void
  t: (key: string) => string
}) {
  if (items.length === 0) return null
  return (
    <div>
      <SectionHeader>{title}</SectionHeader>
      <InsetList>
        {items.map((item, i) => (
          <ListRow
            key={item.id}
            icon={icon}
            glyphColor={glyphColor}
            title={item.name}
            subtitle={getDateSubtitle(item, item.daysUntil, t)}
            trailing={
              item.role ? (
                <span className="text-caption-1 text-label-tertiary capitalize">
                  {item.role}
                </span>
              ) : null
            }
            showChevron={false}
            last={i === items.length - 1}
            onClick={() => onItemClick(item)}
          />
        ))}
      </InsetList>
    </div>
  )
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
      <div className="relative z-10 w-80 rounded-2xl overflow-hidden bg-[var(--surface-elevated)] shadow-xl">
        {children}
      </div>
    </div>
  )
}

interface DateFormData {
  name: string
  type: 'birthday' | 'anniversary' | 'custom'
  date: string
  notes: string
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
  initial?: DateItem
  onSave: (data: DateFormData) => void
  onCancel: () => void
  onDelete?: () => void
  t: (key: string) => string
  saving: boolean
}) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [type, setType] = React.useState<'birthday' | 'anniversary' | 'custom'>(initial?.type ?? 'birthday')
  const [date, setDate] = React.useState(() => {
    if (initial?.date) {
      const d = new Date(initial.date)
      const mm = String(d.getMonth() + 1).padStart(2, '0')
      const dd = String(d.getDate()).padStart(2, '0')
      return `${d.getFullYear()}-${mm}-${dd}`
    }
    return ''
  })
  const [notes, setNotes] = React.useState(initial?.notes ?? '')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ name, type, date, notes })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="px-4 py-4 border-b border-[var(--surface-border)] flex items-center justify-between">
        <p className="text-subhead font-semibold text-label-primary">
          {mode === 'add' ? t('dates.addDate') : t('common.edit')}
        </p>
        <button type="button" onClick={onCancel} className="p-1 rounded-full hover:bg-[var(--surface-secondary)]">
          <X className="w-4 h-4 text-label-secondary" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <label className="block text-caption-1 text-label-secondary mb-1">{t('dates.dateName')}</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="e.g. Emma Johnson"
            required
          />
        </div>
        <div>
          <label className="block text-caption-1 text-label-secondary mb-1">{t('dates.dateType')}</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as typeof type)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          >
            <option value="birthday">{t('dates.dateBirthday')}</option>
            <option value="anniversary">{t('dates.dateAnniversary')}</option>
            <option value="custom">{t('dates.dateCustom')}</option>
          </select>
        </div>
        <div>
          <label className="block text-caption-1 text-label-secondary mb-1">{t('dates.dateDate')}</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            required
          />
        </div>
        <div>
          <label className="block text-caption-1 text-label-secondary mb-1">{t('dates.dateNotes')}</label>
          <input
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>
      <div className="px-4 pb-4 flex gap-2">
        {mode === 'edit' && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="px-3 py-2 rounded-lg text-label-destructive text-subhead font-medium flex items-center gap-1.5 hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" />
            {t('common.delete')}
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

export default function AnniversariesPage() {
  return (
    <FeatureGate featureKey="anniversaries">
      <AnniversariesPageInner />
    </FeatureGate>
  )
}

function AnniversariesPageInner() {
  const { t } = useTranslation()
  const [dates, setDates] = React.useState<ApiDateItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [showAdd, setShowAdd] = React.useState(false)
  const [editItem, setEditItem] = React.useState<DateItem | null>(null)
  const [saving, setSaving] = React.useState(false)

  const fetchDates = React.useCallback(async () => {
    try {
      const res = await fetch('/api/anniversaries')
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setDates(data.dates || [])
      setError(null)
    } catch {
      setError(t('dates.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchDates()
  }, [fetchDates])

  const { birthdays, anniversaries } = buildDateItems(dates)

  const birthdayItems = birthdays.filter(d => d.daysUntil >= 0 && d.daysUntil <= 90)
  const anniversaryItems = anniversaries.filter(d => d.daysUntil >= 0 && d.daysUntil <= 90)
  const laterBirthdays = birthdays.filter(d => d.daysUntil > 90)
  const laterAnniversaries = anniversaries.filter(d => d.daysUntil > 90)

  const handleSave = async (data: DateFormData) => {
    setSaving(true)
    try {
      if (editItem) {
        const res = await fetch(`/api/anniversaries?id=${editItem.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) throw new Error('Failed to update')
      } else {
        const res = await fetch('/api/anniversaries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (!res.ok) throw new Error('Failed to create')
      }
      setShowAdd(false)
      setEditItem(null)
      await fetchDates()
    } catch {
      // keep modal open on error
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!editItem) return
    if (!confirm(t('common.confirm') + '?')) return
    setSaving(true)
    try {
      const res = await fetch(`/api/anniversaries?id=${editItem.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setEditItem(null)
      await fetchDates()
    } catch {
      setSaving(false)
    }
  }

  const handleItemClick = (item: DateItem) => {
    setEditItem(item)
  }

  const closeModal = () => {
    setShowAdd(false)
    setEditItem(null)
  }

  if (loading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">{t('dates.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('dates.subtitle')}</p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-secondary">{t('dates.loading')}</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div>
          <h1 className="text-large-title font-display">{t('dates.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('dates.subtitle')}</p>
        </div>
        <div className="card-apple p-8 text-center">
          <p className="text-subhead text-label-destructive">{error}</p>
          <button
            onClick={fetchDates}
            className="mt-3 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-subhead font-semibold"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">{t('dates.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('dates.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-white text-subhead font-semibold"
        >
          <Plus className="w-4 h-4" />
          {t('dates.addDate')}
        </button>
      </div>

      {birthdayItems.length > 0 && (
        <DateSection
          title={t('dates.birthdays')}
          items={birthdayItems}
          icon={Cake}
          glyphColor="family"
          onItemClick={handleItemClick}
          t={t}
        />
      )}
      {anniversaryItems.length > 0 && (
        <DateSection
          title={t('dates.anniversaries')}
          items={anniversaryItems}
          icon={Heart}
          glyphColor="rewards"
          onItemClick={handleItemClick}
          t={t}
        />
      )}
      {laterBirthdays.length > 0 && (
        <DateSection
          title={t('dates.laterBirthdays')}
          items={laterBirthdays}
          icon={Cake}
          glyphColor="family"
          onItemClick={handleItemClick}
          t={t}
        />
      )}
      {laterAnniversaries.length > 0 && (
        <DateSection
          title={t('dates.laterAnniversaries')}
          items={laterAnniversaries}
          icon={Heart}
          glyphColor="rewards"
          onItemClick={handleItemClick}
          t={t}
        />
      )}

      {dates.length === 0 && (
        <div className="card-apple p-8 text-center">
          <Gift className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
          <h2 className="text-title-3 text-label-primary">{t('dates.empty')}</h2>
          <p className="text-subhead text-label-secondary mt-1">{t('dates.emptySubtitle')}</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-subhead font-semibold"
          >
            {t('dates.addDate')}
          </button>
        </div>
      )}

      {/* Add modal */}
      <Modal open={showAdd && !editItem} onClose={closeModal}>
        <AddEditModal
          mode="add"
          onSave={handleSave}
          onCancel={closeModal}
          t={t}
          saving={saving}
        />
      </Modal>

      {/* Edit modal */}
      <Modal open={!!editItem} onClose={closeModal}>
        {editItem && (
          <AddEditModal
            mode="edit"
            initial={editItem}
            onSave={handleSave}
            onCancel={closeModal}
            onDelete={handleDelete}
            t={t}
            saving={saving}
          />
        )}
      </Modal>
    </div>
  )
}