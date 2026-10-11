'use client'

import * as React from 'react'
import { Gift, Cake, Heart, CalendarDays, Plus, Pencil, Trash2 } from 'lucide-react'
import { ListRow, InsetList, SectionHeader } from '@/components/ui/list-row'
import { FeatureGate } from '@/components/ui/feature-gate'
import { Dialog } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { useAnniversariesText } from '@/i18n/anniversaries'
import { formatDateOnly, toDateOnlyLocal, toDateOnlyUTC } from '@/lib/dates'
import { buildDateItems, type ApiDateItem, type DateItem, type FamilyDate } from '@/lib/anniversary-dates'

// Dates are stored as UTC midnight of the calendar day, so format them in UTC:
// local getters would show the previous day west of UTC.
function formatDate(dateStr: string): string {
  return formatDateOnly(dateStr, { month: 'long', day: 'numeric' })
}

function getDateSubtitle(date: FamilyDate, daysUntil: number, t: (key: string) => string): string {
  const dateStr = formatDate(date.date)
  if (daysUntil === 0) return `${dateStr} · ${t('dates.today')}`
  if (daysUntil === 1) return `${dateStr} · ${t('dates.tomorrow')}`
  return `${dateStr} · ${daysUntil}${t('dates.daysAway')}`
}


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
  glyphColor: 'family' | 'rewards' | 'calendar'
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
  onDelete,
  t,
  saving,
  error,
}: {
  mode: 'add' | 'edit'
  initial?: DateItem
  onSave: (data: DateFormData) => void
  onDelete?: () => void
  t: (key: string) => string
  saving: boolean
  error?: string | null
}) {
  const [name, setName] = React.useState(initial?.name ?? '')
  const [type, setType] = React.useState<'birthday' | 'anniversary' | 'custom'>(initial?.type ?? 'birthday')
  // Stored as UTC midnight: pre-fill the UTC calendar day, or saving an
  // unchanged edit would shift the date back a day west of UTC.
  const [date, setDate] = React.useState(() => (initial?.date ? toDateOnlyUTC(initial.date) : ''))
  const [notes, setNotes] = React.useState(initial?.notes ?? '')

  const nameId = React.useId()
  const typeId = React.useId()
  const dateId = React.useId()
  const notesId = React.useId()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave({ name, type, date, notes })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-footnote text-danger-text">
            {error}
          </p>
        )}
        <div>
          <label htmlFor={nameId} className="block text-caption-1 text-label-secondary mb-1">
            {t('dates.dateName')}
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            placeholder="e.g. Emma Johnson"
            required
          />
        </div>
        <div>
          <label htmlFor={typeId} className="block text-caption-1 text-label-secondary mb-1">
            {t('dates.dateType')}
          </label>
          <select
            id={typeId}
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
          <label htmlFor={dateId} className="block text-caption-1 text-label-secondary mb-1">
            {t('dates.dateDate')}
          </label>
          <input
            id={dateId}
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            required
          />
        </div>
        <div>
          <label htmlFor={notesId} className="block text-caption-1 text-label-secondary mb-1">
            {t('dates.dateNotes')}
          </label>
          <input
            id={notesId}
            type="text"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-[var(--surface-secondary)] text-label-primary text-body placeholder:text-label-tertiary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
      </div>
      <div className="mt-6 flex gap-2">
        {mode === 'edit' && onDelete && (
          <button
            type="button"
            disabled={saving}
            onClick={onDelete}
            className="min-h-[44px] px-3 py-2 rounded-lg text-danger-text text-subhead font-medium flex items-center gap-1.5 hover:bg-[var(--danger-tint)]"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            {t('common.delete')}
          </button>
        )}
        <button
          type="submit"
          disabled={saving}
          className="ml-auto min-h-[44px] px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold disabled:opacity-50"
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
  const [modalError, setModalError] = React.useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<DateItem | null>(null)
  const [deleting, setDeleting] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<'failed' | 'network' | null>(null)
  const addDateRef = React.useRef<HTMLButtonElement>(null)
  const retryDatesRef = React.useRef<HTMLButtonElement>(null)
  const cancelDeleteRef = React.useRef<HTMLButtonElement>(null)
  const mutationRef = React.useRef(false)
  const anniversariesText = useAnniversariesText()

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

  const { birthdays, anniversaries, others } = buildDateItems(dates, toDateOnlyLocal(new Date()))
  const hasDates = birthdays.length + anniversaries.length + others.length > 0

  const birthdayItems = birthdays.filter(d => d.daysUntil >= 0 && d.daysUntil <= 90)
  const anniversaryItems = anniversaries.filter(d => d.daysUntil >= 0 && d.daysUntil <= 90)
  const laterBirthdays = birthdays.filter(d => d.daysUntil > 90)
  const laterAnniversaries = anniversaries.filter(d => d.daysUntil > 90)

  const handleSave = async (data: DateFormData) => {
    if (mutationRef.current) return
    mutationRef.current = true
    setSaving(true)
    setModalError(null)
    try {
      if (editItem) {
        const res = await fetch(`/api/anniversaries/${encodeURIComponent(editItem.id)}`, {
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
      // Keep the modal open and say so.
      setModalError(t('common.error'))
    } finally {
      mutationRef.current = false
      setSaving(false)
    }
  }

  const openDeleteConfirmation = () => {
    if (!editItem || mutationRef.current) return
    setDeleteError(null)
    setDeleteTarget(editItem)
  }

  const closeDeleteConfirmation = () => {
    if (mutationRef.current) return
    setDeleteError(null)
    setDeleteTarget(null)
  }

  const handleDelete = async () => {
    const item = deleteTarget
    if (!item || mutationRef.current) return
    mutationRef.current = true
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/anniversaries/${encodeURIComponent(item.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        setDeleteError('failed')
        return
      }
      setDeleteTarget(null)
      setEditItem(null)
      await fetchDates()
      window.requestAnimationFrame(() => (addDateRef.current ?? retryDatesRef.current)?.focus())
    } catch {
      setDeleteError('network')
    } finally {
      mutationRef.current = false
      setDeleting(false)
    }
  }

  const handleItemClick = (item: DateItem) => {
    if (mutationRef.current) return
    setModalError(null)
    setEditItem(item)
  }

  const closeModal = () => {
    if (mutationRef.current) return
    setModalError(null)
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
          <p className="text-subhead text-danger-text">{error}</p>
          <button
            ref={retryDatesRef}
            onClick={fetchDates}
            className="mt-3 min-h-[44px] min-w-[44px] px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold"
          >
            {t('routeState.tryAgain')}
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
          ref={addDateRef}
          onClick={() => setShowAdd(true)}
          className="flex min-h-[44px] items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-fill)] text-white text-subhead font-semibold"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
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
      {others.length > 0 && (
        <DateSection
          title={t('dates.otherDates')}
          items={others}
          icon={CalendarDays}
          glyphColor="calendar"
          onItemClick={handleItemClick}
          t={t}
        />
      )}

      {!hasDates && (
        <div className="card-apple p-8 text-center">
          <Gift className="w-10 h-10 text-label-tertiary mx-auto mb-3" />
          <h2 className="text-title-3 text-label-primary">{t('dates.empty')}</h2>
          <p className="text-subhead text-label-secondary mt-1">{t('dates.emptySubtitle')}</p>
          <button
            onClick={() => setShowAdd(true)}
            className="mt-4 min-h-[44px] px-4 py-2 rounded-lg bg-[var(--accent-fill)] text-white text-subhead font-semibold"
          >
            {t('dates.addDate')}
          </button>
        </div>
      )}

      {/* Add modal */}
      <Dialog open={showAdd && !editItem} onClose={saving || deleting ? undefined : closeModal} title={t('dates.addDate')}>
        <AddEditModal mode="add" onSave={handleSave} t={t} saving={saving || deleting} error={modalError} />
      </Dialog>

      {/* Edit modal */}
      <Dialog open={!!editItem} onClose={saving || deleting ? undefined : closeModal} title={t('common.edit')}>
        {editItem && (
          <AddEditModal
            mode="edit"
            initial={editItem}
            onSave={handleSave}
            onDelete={openDeleteConfirmation}
            t={t}
            saving={saving || deleting}
            error={modalError}
          />
        )}
      </Dialog>

      {deleteTarget && (
        <Dialog
          open
          role="alertdialog"
          testId="remove-anniversary-dialog"
          title={anniversariesText('deleteTitle', { name: deleteTarget.name })}
          description={anniversariesText('deleteDescription', { name: deleteTarget.name })}
          initialFocusRef={cancelDeleteRef}
          onClose={deleting ? undefined : closeDeleteConfirmation}
          closeLabel={anniversariesText('deleteClose')}
        >
          <div aria-busy={deleting}>
            {deleteError && (
              <p role="alert" className="mb-4 text-sm text-danger-text">
                {deleteError === 'network'
                  ? anniversariesText('deleteNetworkError')
                  : anniversariesText('deleteFailed')}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-3">
              <button
                ref={cancelDeleteRef}
                type="button"
                disabled={deleting}
                onClick={closeDeleteConfirmation}
                className="min-h-[44px] min-w-[44px] rounded-lg border border-input px-4 text-foreground disabled:opacity-60"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleDelete}
                className="btn-destructive min-h-[44px] min-w-[44px] px-4 disabled:opacity-60"
              >
                {deleting
                  ? anniversariesText('deleting')
                  : deleteError
                    ? t('routeState.tryAgain')
                    : t('common.delete')}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  )
}
