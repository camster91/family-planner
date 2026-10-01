'use client'

import * as React from 'react'
import { Plus, StickyNote as NoteIcon } from 'lucide-react'
import { FeatureGate } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

interface Note {
  id: string
  title: string
  body: string
  color: 'yellow' | 'pink' | 'blue'
  created_at: string
}

const noteColors = {
  yellow: {
    bg: 'bg-[var(--tint-meals)]/20',
    border: 'border-[var(--tint-meals)]/30',
    header: 'bg-[var(--tint-meals)]',
  },
  pink: {
    bg: 'bg-[var(--tint-messages)]/20',
    border: 'border-[var(--tint-messages)]/30',
    header: 'bg-[var(--tint-messages)]',
  },
  blue: {
    bg: 'bg-[var(--tint-budget)]/20',
    border: 'border-[var(--tint-budget)]/30',
    header: 'bg-[var(--tint-budget)]',
  },
}

/** The server's `error` text, or null when the body has none. */
async function serverError(res: Response): Promise<string | null> {
  const data = await res.json().catch(() => null)
  return data && typeof data.error === 'string' && data.error ? data.error : null
}

const colorOptions: Array<{ key: 'yellow' | 'pink' | 'blue'; label: string }> = [
  { key: 'yellow', label: 'Yellow' },
  { key: 'pink', label: 'Pink' },
  { key: 'blue', label: 'Blue' },
]

export default function NotesPage() {
  return (
    <FeatureGate featureKey="notes">
      <NotesPageInner />
    </FeatureGate>
  )
}

function NotesPageInner() {
  const { t } = useTranslation()
  const [notes, setNotes] = React.useState<Note[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Modal state: 'add' | 'edit' | null
  const [modalState, setModalState] = React.useState<'add' | 'edit' | null>(null)
  const [selectedNote, setSelectedNote] = React.useState<Note | null>(null)

  // Form state
  const [formTitle, setFormTitle] = React.useState('')
  const [formBody, setFormBody] = React.useState('')
  const [formColor, setFormColor] = React.useState<'yellow' | 'pink' | 'blue'>('yellow')
  const [saving, setSaving] = React.useState(false)
  // Why the last save/delete failed; shown in the modal, which stays open.
  const [modalError, setModalError] = React.useState<string | null>(null)

  const fetchNotes = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/notes')
      if (!res.ok) {
        throw new Error('Failed to fetch notes')
      }
      const data = await res.json()
      setNotes(data.notes || [])
    } catch (err) {
      console.error('Error fetching notes:', err)
      setError(t('notes.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchNotes()
  }, [fetchNotes])

  const openAddModal = () => {
    setFormTitle('')
    setFormBody('')
    setFormColor('yellow')
    setSelectedNote(null)
    setModalError(null)
    setModalState('add')
  }

  const openEditModal = (note: Note) => {
    setFormTitle(note.title)
    setFormBody(note.body)
    setFormColor(note.color)
    setSelectedNote(note)
    setModalError(null)
    setModalState('edit')
  }

  const closeModal = () => {
    setModalState(null)
    setSelectedNote(null)
    setFormTitle('')
    setFormBody('')
    setFormColor('yellow')
    setModalError(null)
  }

  const handleSave = async () => {
    if (!formTitle.trim()) return

    setSaving(true)
    setModalError(null)
    try {
      const payload = { title: formTitle.trim(), body: formBody.trim(), color: formColor }
      let res: Response
      if (modalState === 'add') {
        res = await fetch('/api/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else if (modalState === 'edit' && selectedNote) {
        // Edit and delete live on /api/notes/[id]; /api/notes is GET/POST only.
        res = await fetch(`/api/notes/${encodeURIComponent(selectedNote.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedNote.id, ...payload }),
        })
      } else {
        return
      }
      if (!res.ok) {
        setModalError(`${t('notes.errorSave')} ${(await serverError(res)) ?? t('common.tryAgain')}`)
        return
      }
      await fetchNotes()
      closeModal()
    } catch {
      // Network failure: keep the modal and what was typed.
      setModalError(`${t('notes.errorSave')} ${t('common.networkError')}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!selectedNote) return

    setSaving(true)
    setModalError(null)
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedNote.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedNote.id }),
      })
      if (!res.ok) {
        setModalError(`${t('notes.errorDelete')} ${(await serverError(res)) ?? t('common.tryAgain')}`)
        return
      }
      await fetchNotes()
      closeModal()
    } catch {
      setModalError(`${t('notes.errorDelete')} ${t('common.networkError')}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-large-title font-display">{t('notes.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('notes.subtitle')}</p>
        </div>
        <button
          type="button"
          className="btn-tinted"
          onClick={openAddModal}
          aria-label={t('notes.addNote')}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{t('notes.addNote')}</span>
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[160px]" />
        </div>
      ) : error ? (
        <EmptyState
          icon={NoteIcon}
          glyphColor="gray"
          title={t('notes.errorLoad')}
          description={error}
          action={
            <button className="btn-secondary" onClick={fetchNotes}>
              {t('common.loading')}
            </button>
          }
        />
      ) : notes.length === 0 ? (
        <EmptyState
          icon={NoteIcon}
          glyphColor="gray"
          title={t('notes.empty')}
          action={
            <button className="btn-tinted" onClick={openAddModal}>
              <Plus className="w-4 h-4 mr-2" />
              {t('notes.addNote')}
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 stagger">
          {notes.map((note) => {
            const colors = noteColors[note.color]
            return (
              <div
                key={note.id}
                role="button"
                tabIndex={0}
                onClick={() => openEditModal(note)}
                onKeyDown={(e) => e.key === 'Enter' && openEditModal(note)}
                className={cn(
                  'card-apple border-[1.5px] overflow-hidden',
                  'flex flex-col h-[160px] cursor-pointer',
                  colors.bg,
                  colors.border
                )}
              >
                {/* Colored header strip */}
                <div className={cn('h-1.5 w-full', colors.header)} />

                {/* Content */}
                <div className="flex-1 p-4 flex flex-col">
                  <div className="flex items-start gap-2 mb-2">
                    <NoteIcon className="w-4 h-4 text-label-tertiary mt-0.5 shrink-0" />
                    <h3 className="text-headline text-label-primary line-clamp-1">
                      {note.title}
                    </h3>
                  </div>
                  <p className="text-subhead text-label-secondary line-clamp-3 flex-1">
                    {note.body}
                  </p>
                </div>
              </div>
            )
          })}

          {/* Add note card */}
          <button
            type="button"
            onClick={openAddModal}
            className={cn(
              'card-apple border-2 border-dashed border-[var(--surface-separator)]',
              'flex flex-col items-center justify-center h-[160px]',
              'text-label-tertiary hover:border-[var(--accent)] hover:text-[var(--accent)]',
              'transition-colors duration-[var(--duration-fast)]'
            )}
          >
            <Plus className="w-8 h-8 mb-2" />
            <span className="text-subhead">{t('notes.newNote')}</span>
          </button>
        </div>
      )}

      {/* Modal */}
      <Dialog
        open={modalState !== null}
        onClose={closeModal}
        title={modalState === 'add' ? t('notes.newNote') : formTitle || t('notes.title')}
      >
        <div>
            {/* Form */}
            <div className="space-y-4">
              {/* Title */}
              <div>
                <label htmlFor="note-title" className="block text-subhead font-medium text-label-primary mb-1.5">
                  {t('notes.noteTitle')}
                </label>
                <input
                  id="note-title"
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="input-apple w-full"
                  placeholder={t('notes.noteTitle')}
                />
              </div>

              {/* Body */}
              <div>
                <label htmlFor="note-body" className="block text-subhead font-medium text-label-primary mb-1.5">
                  {t('notes.noteBody')}
                </label>
                <textarea
                  id="note-body"
                  value={formBody}
                  onChange={(e) => setFormBody(e.target.value)}
                  className="input-apple w-full min-h-[100px] resize-none"
                  placeholder={t('notes.noteBody')}
                />
              </div>

              {/* Color picker */}
              <div>
                <p id="note-color-label" className="block text-subhead font-medium text-label-primary mb-2">
                  {t('notes.color')}
                </p>
                <div role="group" aria-labelledby="note-color-label" className="flex gap-3">
                  {colorOptions.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setFormColor(opt.key)}
                      className={cn(
                        'w-10 h-10 rounded-full transition-transform',
                        formColor === opt.key ? 'scale-110 ring-2 ring-offset-2 ring-[var(--accent)]' : ''
                      )}
                      style={{
                        backgroundColor: opt.key === 'yellow' ? 'var(--tint-meals)' : opt.key === 'pink' ? 'var(--tint-messages)' : 'var(--tint-budget)',
                      }}
                      aria-label={opt.label}
                      aria-pressed={formColor === opt.key}
                    />
                  ))}
                </div>
              </div>

              {modalError && (
                <p role="alert" className="text-footnote text-[var(--danger-text)]">
                  {modalError}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-between border-t border-[var(--surface-separator)] pt-4">
              {modalState === 'edit' ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="btn-destructive"
                >
                  {t('notes.delete')}
                </button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  className="btn-secondary"
                >
                  {t('notes.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !formTitle.trim()}
                  className="btn-primary"
                >
                  {saving ? t('common.saving') : t('notes.save')}
                </button>
              </div>
            </div>
        </div>
      </Dialog>
    </div>
  )
}