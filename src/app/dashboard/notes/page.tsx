'use client'

import * as React from 'react'
import { noteCreateContext, makeNoteCreateIntent, postNoteCreate, inspectNoteCreateReceipt, NOTE_CREATE_RETRY_MS, type NoteCreateOutcome, type NoteCreateContext, type NoteCreateIntent, type NoteCreateDraft } from '@/lib/note-create-client'
import { requestOwnedJson } from '@/lib/owned-request-http'
import { readBoundedJsonResponse } from '@/lib/bounded-json-response'
import Link from 'next/link'
import { Plus, StickyNote as NoteIcon } from 'lucide-react'
import { useFeatureEnabled, useFeatures } from '@/components/providers/features-provider'
import { FeatureOffState } from '@/components/ui/feature-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { usePendingFormNavigationController } from '@/components/layout/pending-form-navigation'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { useDisplayLocale } from '@/components/ui/use-display-locale'

type NoteJournal = ReturnType<typeof import('@/lib/note-create-recovery-browser').browserNoteRecovery>
type NoteEntry = import('@/lib/note-create-recovery-contract').NoteRecoveryEntry
type PendingNoteCreate = { intent: NoteCreateIntent; draft: NoteCreateDraft; uncertain: boolean; terminal?: Extract<NoteCreateOutcome, { kind: 'confirmed' | 'removed' }> }

interface Note {
  id: string
  title: string
  body: string
  color: 'yellow' | 'pink' | 'blue' | 'green' | 'purple'
  updated_at?: string
  created_at: string
  /** Server-computed D9 permissions; absent only for older compatible clients. */
  can_edit?: boolean
  can_delete?: boolean
}

type NotesLoadError = 'load' | 'household' | null
const NOTE_PAGE_SIZE = 24
const NOTE_READ_TIMEOUT_MS = 15_000

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
  green: { bg: 'bg-[var(--tint-lists)]/20', border: 'border-[var(--tint-lists)]/30', header: 'bg-[var(--tint-lists)]' },
  purple: { bg: 'bg-[var(--tint-chore)]/20', border: 'border-[var(--tint-chore)]/30', header: 'bg-[var(--tint-chore)]' },
  blue: {
    bg: 'bg-[var(--tint-budget)]/20',
    border: 'border-[var(--tint-budget)]/30',
    header: 'bg-[var(--tint-budget)]',
  },
}

function isNoteList(value: unknown): value is Note[] {
  if (!Array.isArray(value)) return false
  return value.every((note) => note && typeof note === 'object' && typeof note.id === 'string' && note.id.length > 0 &&
    typeof note.title === 'string' && typeof note.body === 'string' && typeof note.color === 'string' && Object.hasOwn(noteColors, note.color) &&
    typeof note.created_at === 'string' && (note.updated_at === undefined || (typeof note.updated_at === 'string' && Number.isFinite(Date.parse(note.updated_at)))) && ['can_edit', 'can_delete'].every((key) => note[key] === undefined || typeof note[key] === 'boolean')) &&
    new Set(value.map((note) => note.id)).size === value.length
}

function isRecoveryOwnerChange(value: unknown) {
  return Boolean(value && typeof value === 'object' && 'reason' in value && value.reason === 'OWNER_CHANGED')
}

type MutationError = { createRecovery?: boolean; current?: Note; action: 'save' | 'delete'; raw?: string; fallback: 'common.tryAgain' | 'common.networkError' }


export default function NotesPage() {
  const enabled = useFeatureEnabled('notes')
  return enabled ? <NotesPageInner /> : <NotesFeatureOffState />
}

function NotesFeatureOffState() {
  const { canManage } = useFeatures()
  const { t } = useTranslation()

  return (
    <FeatureOffState
      featureKey="notes"
      canManage={canManage}
      headingLevel={1}
      testId="notes-feature-off"
      copy={{
        title: t('notes.featureOffTitle'),
        description: t('notes.featureOffDescription'),
        askParent: t('notes.featureOffAskParent'),
        openFeatures: t('notes.openFeatures'),
      }}
    />
  )
}

function NotesPageInner() {
  const { canManage } = useFeatures()
  const { t } = useTranslation()
  const locale = useDisplayLocale()
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const colorOptions: Array<{ key: 'yellow' | 'pink' | 'blue' | 'green' | 'purple'; label: string }> = [
    { key: 'yellow', label: t('notes.colorYellow') },
    { key: 'pink', label: t('notes.colorPink') },
    { key: 'blue', label: t('notes.colorBlue') },
    { key: 'green', label: t('notes.colorGreen') },
    { key: 'purple', label: t('notes.colorPurple') },
  ]
  const [notes, setNotes] = React.useState<Note[]>([])
  const [loading, setLoading] = React.useState(true)
  const [pageCursor, setPageCursor] = React.useState<string | null>(null)
  const [pageTrail, setPageTrail] = React.useState<Array<string | null>>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const readGeneration = React.useRef(0)
  const activeRead = React.useRef<AbortController | null>(null)
  const retryPage = React.useRef<{ cursor: string | null; trail: Array<string | null> }>({ cursor: null, trail: [] })
  // Keep the failure semantic so a locale change can translate the existing
  // recovery surface without starting the request over.
  const [error, setError] = React.useState<NotesLoadError>(null)

  // Modal state: 'add' | 'edit' | null
  const [modalState, setModalState] = React.useState<'add' | 'edit' | null>(null)
  const [selectedNote, setSelectedNote] = React.useState<Note | null>(null)
  const [viewingNote, setViewingNote] = React.useState<Note | null>(null)
  const dialogOpen = React.useRef(false)
  React.useEffect(() => {
    dialogOpen.current = modalState !== null || viewingNote !== null
  }, [modalState, viewingNote])
  const [notice, setNotice] = React.useState<'createRemoved' | 'saved' | 'deleted' | 'savedRefreshFailed' | 'deletedRefreshFailed' | null>(null)

  // Form state
  const [formTitle, setFormTitle] = React.useState('')
  const [formBody, setFormBody] = React.useState('')
  const [formColor, setFormColor] = React.useState<'yellow' | 'pink' | 'blue' | 'green' | 'purple'>('yellow')
  const [saving, setSaving] = React.useState(false)
  const writeContext = React.useRef<NoteCreateContext | null>(null)
  const pendingCreate = React.useRef<PendingNoteCreate | null>(null)
  const [createHeld, setCreateHeld] = React.useState(false)
  const mutationLock = React.useRef(false)
  const recoveryJournal = React.useRef<NoteJournal | null>(null)
  const recoveryModule = React.useRef<typeof import('@/lib/note-create-recovery-browser') | null>(null)
  const [recoveryTarget, setRecoveryTarget] = React.useState<NoteCreateContext | null>(null)
  const [recoveryState, setRecoveryState] = React.useState<'off' | 'loading' | 'ready' | 'blocked'>('off')
  const [recoveredEntry, setRecoveredEntry] = React.useState<NoteEntry | null>(null)
  const [recoveryAttempt, retryRecoveryInitialization] = React.useState(0)
  const recoveryLock = React.useRef(false)
  const saveButtonRef = React.useRef<HTMLButtonElement>(null)
  const repairButtonRef = React.useRef<HTMLButtonElement>(null)
  // Keep browser Back on this route while a note save/delete or explicit storage repair is in flight.
  // Dialog dismissal is disabled separately so Escape/backdrop/close cannot
  // clear a draft before the server answers.
  usePendingFormNavigationController(saving || (recoveryState === 'loading' && recoveryLock.current))
  // Why the last save/delete failed; shown in the modal, which stays open.
  const [modalError, setModalError] = React.useState<MutationError | null>(null)

  const clearPersonalSurface = React.useCallback(() => {
    // A changed/revoked personal context must not display the previous draft.
    // Its owned persistent journal is retained for the existing retirement rules.
    writeContext.current = null; pendingCreate.current = null; recoveryJournal.current = null
    setRecoveryTarget(null); setRecoveredEntry(null); setCreateHeld(false)
    setNotes([]); setModalState(null); setSelectedNote(null); setViewingNote(null)
    setFormTitle(''); setFormBody(''); setFormColor('yellow'); setModalError(null); setNotice(null)
  }, [])

  const fetchNotes = React.useCallback(async (
    preserveError = false,
    cursor: string | null = null,
    trail: Array<string | null> = [],
  ) => {
    const generation = ++readGeneration.current
    activeRead.current?.abort()
    const controller = new AbortController()
    activeRead.current = controller
    retryPage.current = { cursor, trail: [...trail] }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      setLoading(true)
      if (!preserveError) setError(null)
      const params = new URLSearchParams({ limit: String(NOTE_PAGE_SIZE) })
      if (cursor !== null) params.set('cursor', cursor)
      // The deadline includes body reading, even if a transport ignores abort.
      const result = await Promise.race([
        (async () => {
          const res = await fetch(`/api/notes?${params}`, { signal: controller.signal, cache: 'no-store' })
          // Revoked personal authority does not depend on a readable error body.
          if (res.status === 401 || res.status === 403) return { res, data: null }
          const body = await readBoundedJsonResponse(res, controller.signal, 2 * 1024 * 1024)
          const data = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
          return { res, data }
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new Error('Notes read timed out'))
          }, NOTE_READ_TIMEOUT_MS)
        }),
      ])
      if (generation !== readGeneration.current || controller.signal.aborted) return false
      const { res, data } = result
      if (res.status === 401 || res.status === 403) {
        clearPersonalSurface(); setError('load'); return false
      }
      if (res.status === 400 && data?.error === 'You must belong to a family') {
        clearPersonalSurface()
        setNextCursor(null)
        setPageCursor(null)
        setPageTrail([])
        setViewingNote(null)
        setModalState(null)
        setSelectedNote(null)
        setFormTitle('')
        setFormBody('')
        setFormColor('yellow')
        setModalError(null)
        setNotice(null)
        setError('household')
        return false
      }
      if (!res.ok) throw new Error('Failed to fetch notes')
      if (!data || !isNoteList(data.notes) || data.notes.length > NOTE_PAGE_SIZE ||
        !(data.nextCursor === null || (typeof data.nextCursor === 'string' &&
          /^[A-Za-z0-9_-]{1,1024}$/.test(data.nextCursor) && data.notes.length === NOTE_PAGE_SIZE &&
          data.nextCursor !== cursor && !trail.includes(data.nextCursor)))) {
        throw new Error('Invalid notes page')
      }
      const nextContext = noteCreateContext(data.writeContext)
      const previousContext = writeContext.current
      if (previousContext && (!nextContext || previousContext.userId !== nextContext.userId || previousContext.familyId !== nextContext.familyId)) {
        clearPersonalSurface()
      }
      writeContext.current = nextContext
      setRecoveryTarget(previous => nextContext && (data.recoveryAdopted === true ||
        (previous?.userId === nextContext.userId && previous.familyId === nextContext.familyId))
        ? previous?.userId === nextContext.userId && previous.familyId === nextContext.familyId ? previous : nextContext : null)
      setError(null)
      setNotes(data.notes)
      setPageCursor(cursor)
      setPageTrail([...trail])
      setNextCursor(data.nextCursor)
      setNotice(null)
      return true
    } catch {
      if (generation === readGeneration.current) setError('load')
      return false
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (generation === readGeneration.current) {
        activeRead.current = null
        setLoading(false)
      }
    }
  }, [clearPersonalSurface])

  React.useEffect(() => {
    void fetchNotes()
    return () => {
      ++readGeneration.current
      activeRead.current?.abort()
    }
  }, [fetchNotes])

  React.useEffect(() => {
    if (modalState === null && (notice || error === 'household')) headingRef.current?.focus()
  }, [notice, modalState, error])

  const loadErrorMessage = error === 'load' ? t('notes.errorLoad') : null

  const showNotesPage = (cursor: string | null = null, trail: Array<string | null> = [], preserveError = false) => {
    void fetchNotes(preserveError, cursor, trail).then((loaded) => {
      if (loaded && !dialogOpen.current) headingRef.current?.focus()
    })
  }

  const adoptRecoveredRows = React.useCallback((rows: NoteEntry[]) => {
    setRecoveredEntry(rows[0] ?? null)
    if (rows[0]) setCreateHeld(true)
    setRecoveryState('ready')
  }, [])
  React.useEffect(() => {
    if (!recoveryTarget) { recoveryJournal.current = null; setRecoveredEntry(null); setRecoveryState('off'); return }
    let active = true
    setRecoveryState('loading')
    void (async () => {
      try {
        const module = await import('@/lib/note-create-recovery-browser')
        if (!active) return
        const journal = module.browserNoteRecovery(recoveryTarget)
        recoveryModule.current = module; recoveryJournal.current = journal
        const rows = await journal.initialize()
        if (active) adoptRecoveredRows(rows)
      } catch (cause) { if (active) {
        if (isRecoveryOwnerChange(cause)) { clearPersonalSurface(); setError('load') } else setRecoveryState('blocked')
      } }
    })()
    return () => { active = false }
  }, [recoveryTarget, recoveryAttempt, adoptRecoveredRows, clearPersonalSurface])

  const finishCreate = async (outcome: Extract<NoteCreateOutcome, { kind: 'confirmed' | 'removed' }>) => {
    pendingCreate.current = null; setRecoveredEntry(null); setCreateHeld(false)
    const refreshed = await fetchNotes()
    setNotice(outcome.kind === 'removed' ? 'createRemoved' : refreshed ? 'saved' : 'savedRefreshFailed')
    resetModal()
  }
  React.useEffect(() => {
    if (recoveryState !== 'blocked' || modalState !== 'add') return
    // Keep copying/reading focus; move only the disabled Save/body focus to recovery.
    if (document.activeElement === saveButtonRef.current || document.activeElement === document.body)
      repairButtonRef.current?.focus()
  }, [recoveryState, modalState])

  const repairRecovery = async () => {
    if (recoveryLock.current || mutationLock.current) return
    const journal = recoveryJournal.current
    if (!journal) { retryRecoveryInitialization(value => value + 1); return }
    recoveryLock.current = true; setRecoveryState('loading')
    try {
      const rows = journal.hasUncertainStorage() ? await journal.recoverStorage() : await journal.initialize()
      adoptRecoveredRows(rows)
      if (!rows.length && pendingCreate.current?.terminal) await finishCreate(pendingCreate.current.terminal)
    } catch (cause) {
      if (isRecoveryOwnerChange(cause)) { clearPersonalSurface(); setError('load') } else setRecoveryState('blocked')
    } finally { recoveryLock.current = false }
  }

  const openAddModal = () => {
    if (recoveredEntry && recoveryModule.current) {
      const intent = recoveryModule.current.noteIntentFromEntry(recoveredEntry)
      const body = JSON.parse(intent.body) as NoteCreateDraft
      pendingCreate.current = { intent, draft: { title: body.title, body: body.body, color: body.color }, uncertain: true }
    }
    if (pendingCreate.current) {
      const draft = pendingCreate.current.draft
      setFormTitle(draft.title); setFormBody(draft.body); setFormColor(draft.color as Note['color'])
      setSelectedNote(null); setModalError({ action: 'save', createRecovery: true, fallback: 'common.tryAgain' })
      setModalState('add'); return
    }
    setNotice(null)
    setFormTitle('')
    setFormBody('')
    setFormColor('yellow')
    setSelectedNote(null)
    setModalError(null)
    setModalState('add')
  }

  const openEditModal = (note: Note) => {
    setNotice(null)
    setFormTitle(note.title)
    setFormBody(note.body)
    setFormColor(note.color)
    setSelectedNote(note)
    setModalError(null)
    setModalState('edit')
  }

  const resetModal = () => {
    setModalState(null)
    setSelectedNote(null)
    setFormTitle('')
    setFormBody('')
    setFormColor('yellow')
    setModalError(null)
  }

  const closeModal = () => {
    if (saving) return
    resetModal()
  }

  const handleSave = async () => {
    if (mutationLock.current || recoveryLock.current || saving || loading || modalError?.current || !formTitle.trim()) return
    if (modalState === 'add' && recoveryTarget && recoveryState !== 'ready') {
      setModalError({ action: 'save', raw: t('notes.recoveryBlocked'), fallback: 'common.tryAgain' }); return
    }
    mutationLock.current = true

    setSaving(true)
    setModalError(null)
    try {
      const payload = { title: formTitle.trim(), body: formBody.trim(), color: formColor }
      if (modalState === 'add') {
        if (!pendingCreate.current) {
          if (!writeContext.current) {
            setModalError({ action: 'save', raw: t('notes.createContextUnavailable'), fallback: 'common.tryAgain' }); return
          }
          pendingCreate.current = { intent: makeNoteCreateIntent(payload, writeContext.current), draft: { ...payload }, uncertain: false }
        }
        const pending = pendingCreate.current
        let outcome: NoteCreateOutcome
        const journal = recoveryTarget ? recoveryJournal.current : null
        if (recoveryTarget) {
          if (!journal || !recoveryModule.current) throw new Error('Owned note recovery unavailable')
          const entry: NoteEntry = { kind: 'note-create', key: pending.intent.key, body: pending.intent.body, issuedAt: pending.intent.issuedAt }
          const rows = await journal.snapshot()
          if (!rows.some(row => row.key === entry.key && row.body === entry.body && row.issuedAt === entry.issuedAt)) await journal.stage(entry)
          setRecoveredEntry(entry)
          const inspected = await journal.inspect(entry.key, (row, context) => inspectNoteCreateReceipt(recoveryModule.current!.noteIntentFromEntry(row), context.owner?.scope))
          if (inspected.state === 'present' || inspected.state === 'removed') outcome = { kind: inspected.state === 'present' ? 'confirmed' : 'removed', noteId: inspected.noteId }
          else if (inspected.state === 'expired') outcome = { kind: 'refused', code: 'NOTE_RECOVERY_EXPIRED' }
          else if (inspected.state === 'unissued') {
            const age = Date.now() - entry.issuedAt
            outcome = age < 0 || age > NOTE_CREATE_RETRY_MS ? { kind: 'refused', code: 'NOTE_RECOVERY_EXPIRED' }
              : await journal.send(entry.key, true, (row, ownerScope) => postNoteCreate(recoveryModule.current!.noteIntentFromEntry(row), { ownerScope }))
          } else outcome = { kind: 'unknown' }
        } else outcome = await postNoteCreate(pending.intent, { recovery: pending.uncertain })
        if (outcome.kind === 'refused' && ['NOTE_OWNER_CHANGED', 'NOTE_RECOVERY_OWNER_CHANGED'].includes(outcome.code)) {
          clearPersonalSurface(); setError('load'); return
        }
        if (outcome.kind === 'removed' || outcome.kind === 'confirmed') {
          pending.terminal = outcome
          if (journal) await journal.dismiss(pending.intent.key)
          await finishCreate(outcome); return
        }
        {
          if (outcome.kind === 'unknown' || pending.uncertain || journal || outcome.code === 'NOTE_RECOVERY_EXPIRED') {
            pending.uncertain = true; setCreateHeld(true)
            setModalError({ action: 'save', createRecovery: true, raw: outcome.kind === 'refused' && outcome.code === 'NOTE_RECOVERY_EXPIRED' ? t('notes.createExpired') : undefined, fallback: 'common.tryAgain' })
          } else {
            pendingCreate.current = null; setCreateHeld(false)
            setModalError({ action: 'save', raw: outcome.message, fallback: 'common.tryAgain' })
          }
          return
        }

      } else if (modalState === 'edit' && selectedNote) {
        // Edit and delete live on /api/notes/[id]; /api/notes is GET/POST only.
        const result = await requestOwnedJson(`/api/notes/${encodeURIComponent(selectedNote.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedNote.id, ...payload, ...(selectedNote.updated_at ? { expected_updated_at: selectedNote.updated_at } : {}) }),
        }, 256 * 1024)
        // A missing reply can follow a committed edit. Keep the draft/version;
        // an explicit retry still passes through the server's conflict review.
        if (result.kind === 'unknown') {
          setModalError({ action: 'save', fallback: 'common.networkError' }); return
        }
        const data = result.body && typeof result.body === 'object' ? result.body as { error?: unknown; current?: unknown } : null
        if (!result.response.ok) {
          const code = data?.error && typeof data.error === 'object' && 'code' in data.error ? data.error.code : undefined
          if (result.response.status === 409 && code === 'NOTE_CHANGED' && isNoteList([data?.current])) {
            const current = data?.current as Note
            if (current.id === selectedNote.id && current.updated_at) {
              setModalError({ action: 'save', current, fallback: 'common.tryAgain' }); return
            }
          }
          setModalError({ action: 'save', raw: typeof data?.error === 'string' ? data.error : undefined, fallback: 'common.tryAgain' }); return
        }
      } else {
        return
      }
      const refreshed = await fetchNotes()
      setNotice(refreshed ? 'saved' : 'savedRefreshFailed')
      resetModal()
    } catch (cause) {
      if (isRecoveryOwnerChange(cause)) { clearPersonalSurface(); setError('load'); return }
      // A transport failure is not evidence that a create rolled back.
      if (modalState === 'add' && pendingCreate.current) {
        pendingCreate.current.uncertain = true; setCreateHeld(true)
        if (recoveryTarget) setRecoveryState('blocked')
        setModalError({ action: 'save', createRecovery: true, fallback: 'common.networkError' })
      } else setModalError({ action: 'save', fallback: 'common.networkError' })
    } finally {
      mutationLock.current = false
      setSaving(false)
    }
  }

  const reviewConflict = (keepDraft: boolean) => {
    const current = modalError?.current
    if (!current || !selectedNote || current.id !== selectedNote.id || saving) return
    setSelectedNote({ ...selectedNote, ...current })
    if (!keepDraft) { setFormTitle(current.title); setFormBody(current.body); setFormColor(current.color) }
    setModalError(null) // No save is sent until the person explicitly presses Save.
  }

  const handleDelete = async () => {
    if (mutationLock.current || saving || loading || !selectedNote) return
    mutationLock.current = true

    setSaving(true)
    setModalError(null)
    try {
      const result = await requestOwnedJson(`/api/notes/${encodeURIComponent(selectedNote.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedNote.id }),
      }, 32 * 1024)
      if (result.kind === 'unknown') {
        // Keep confirmation open: timeout does not prove deletion rolled back.
        setModalError({ action: 'delete', fallback: 'common.networkError' }); return
      }
      if (!result.response.ok) {
        const data = result.body && typeof result.body === 'object' ? result.body as { error?: unknown } : null
        setModalError({ action: 'delete', raw: typeof data?.error === 'string' ? data.error : undefined, fallback: 'common.tryAgain' })
        return
      }
      const refreshed = await fetchNotes()
      setNotice(refreshed ? 'deleted' : 'deletedRefreshFailed')
      resetModal()
    } catch {
      setModalError({ action: 'delete', fallback: 'common.networkError' })
    } finally {
      mutationLock.current = false
      setSaving(false)
    }
  }

  return (
    <div className="min-w-0 space-y-6" data-testid="notes-workspace">
      {/* Header */}
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-large-title font-display rounded-[var(--radius-sm)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">{t('notes.title')}</h1>
          <p className="text-subhead text-label-secondary mt-0.5">{t('notes.subtitle')}</p>
          {!loading && !error && <p className="mt-2 text-footnote text-label-secondary">{t(notes.length === 1 ? 'notes.pageCountOne' : 'notes.pageCountMany', { count: notes.length.toLocaleString(locale) })}</p>}
        </div>
        {error !== 'household' && <button
          type="button"
          className="btn-tinted"
          onClick={openAddModal}
          disabled={saving || Boolean(recoveryTarget && recoveryState !== 'ready')}
          aria-label={t('notes.addNote')}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>{t('notes.addNote')}</span>
        </button>}
      </div>

      {notice && <p role="status" className="card-apple px-4 py-3 text-subhead text-label-primary">{t(`notes.${notice}`)}</p>}

      {recoveryTarget && (recoveryState === 'loading' || recoveryState === 'blocked' || recoveredEntry) && (
        <section className="card-apple p-4 space-y-2" aria-label={t('notes.recoveryTitle')}>
          <p role={recoveryState === 'blocked' ? 'alert' : 'status'}>{t(recoveryState === 'loading' ? 'notes.recoveryLoading' : recoveryState === 'blocked' ? 'notes.recoveryBlocked' : 'notes.recoveryAvailable')}</p>
          {recoveryState === 'blocked' && <button type="button" className="btn-secondary min-h-[44px]" onClick={repairRecovery}>{t('notes.repairRecovery')}</button>}
          {recoveredEntry && recoveryState === 'ready' && <button type="button" className="btn-tinted min-h-[44px]" onClick={openAddModal} disabled={saving}>{t('notes.reviewRecovery')}</button>}
        </section>
      )}

      {/* Content */}
      {error === 'household' ? (
        <EmptyState icon={NoteIcon} title={t('notes.chooseHousehold')} description={t('notes.chooseHouseholdDescription')} action={
          <div className="flex flex-wrap justify-center gap-3">
            {canManage && <Link href="/dashboard/family/create" className="btn-tinted min-h-[44px]">{t('notes.createHousehold')}</Link>}
            <Link href="/join" className="btn-secondary min-h-[44px]">{t('notes.joinHousehold')}</Link>
          </div>
        } />
      ) : error ? (
        <EmptyState
          icon={NoteIcon}
          glyphColor="gray"
          title={loadErrorMessage ?? t('notes.errorLoad')}
          description={loadErrorMessage ?? t('notes.errorLoad')}
          action={
            <button
              type="button"
              className="btn-secondary min-h-11 min-w-11"
              onClick={() => showNotesPage(retryPage.current.cursor, retryPage.current.trail, true)}
              disabled={loading}
              aria-busy={loading}
              data-testid="notes-retry"
            >
              {loading ? t('notes.loading') : t('notes.retry')}
            </button>
          }
        />
      ) : loading ? (
        <div role="status" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <span className="sr-only">{t('notes.loading')}</span>
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[160px]" />
          <Skeleton className="h-[160px]" />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={NoteIcon}
          glyphColor="gray"
          title={t(pageCursor === null ? 'notes.empty' : 'notes.noOlder')}
        />
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 stagger">
          {notes.map((note) => {
            const colors = noteColors[note.color] ?? noteColors.yellow
            const canEdit = note.can_edit ?? true
            return (
              <div
                key={note.id}
                data-testid="note-card"
                data-note-id={note.id}
                {...(canEdit
                  ? {
                      role: 'button' as const,
                      tabIndex: 0,
                      'aria-label': note.title,
                      onClick: () => openEditModal(note),
                      onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          openEditModal(note)
                        }
                      },
                    }
                  : {})}
                className={cn(
                  'card-apple border-[1.5px] overflow-hidden',
                  'flex min-w-0 flex-col min-h-[160px]',
                  canEdit && 'cursor-pointer',
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
                    <h2 className="min-w-0 text-headline text-label-primary line-clamp-2 [overflow-wrap:anywhere]">
                      {note.title}
                    </h2>
                  </div>
                  <p className="text-subhead text-label-secondary line-clamp-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {note.body}
                  </p>
                  {!canEdit && <button type="button" aria-label={`${t('notes.readNote')}: ${note.title}`} onClick={() => setViewingNote(note)} className="btn-plain mt-3 min-h-[44px] min-w-[44px] self-start">{t('notes.readNote')}</button>}
                </div>
              </div>
            )
          })}


        </div>
      )}

      {error !== 'household' && !modalState && (error || pageTrail.length > 0 || nextCursor !== null) && (
        <nav aria-label={t('notes.pages')} className="flex flex-wrap items-center gap-3">
          {(error || pageCursor !== null) && <button type="button" className="btn-secondary min-h-[44px]"
            disabled={loading} onClick={() => showNotesPage()}>{t('notes.newest')}</button>}
          {!error && pageTrail.length > 0 && <button type="button" className="btn-secondary min-h-[44px]"
            disabled={loading} onClick={() => showNotesPage(pageTrail[pageTrail.length - 1], pageTrail.slice(0, -1))}>{t('notes.previous')}</button>}
          {!error && nextCursor !== null && <button type="button" className="btn-secondary min-h-[44px]"
            disabled={loading} onClick={() => showNotesPage(nextCursor, [...pageTrail, pageCursor])}>{t('notes.older')}</button>}
        </nav>
      )}

      <Dialog open={viewingNote !== null} onClose={() => setViewingNote(null)} title={viewingNote?.title ?? t('notes.title')} closeLabel={t('notes.close')} description={t('notes.readOnly')} variant="form">
        <p className="whitespace-pre-wrap text-body text-label-primary [overflow-wrap:anywhere]">{viewingNote?.body}</p>
        <button type="button" className="btn-secondary mt-5 min-h-[44px]" onClick={() => setViewingNote(null)}>{t('notes.close')}</button>
      </Dialog>

      {/* Modal */}
      <Dialog
        open={modalState !== null}
        onClose={saving ? undefined : closeModal}
        title={modalState === 'add' ? t('notes.newNote') : formTitle || t('notes.title')}
        closeLabel={t('notes.close')}
        variant="form"
        description={t('notes.subtitle')}
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
                  maxLength={200}
                  readOnly={saving || (modalState === 'add' && createHeld)}
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
                  maxLength={10000}
                  readOnly={saving || (modalState === 'add' && createHeld)}
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
                      disabled={saving || (modalState === 'add' && createHeld)}
                      className={cn(
                        'inline-flex h-11 w-11 items-center justify-center rounded-full transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                        formColor === opt.key ? 'scale-110 ring-2 ring-offset-2 ring-[var(--accent)]' : ''
                      )}
                      aria-label={opt.label}
                      aria-pressed={formColor === opt.key}
                    >
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rounded-full"
                        style={{
                          backgroundColor: opt.key === 'yellow' ? 'var(--tint-meals)' : opt.key === 'pink' ? 'var(--tint-messages)' : opt.key === 'blue' ? 'var(--tint-budget)' : opt.key === 'green' ? 'var(--tint-lists)' : 'var(--tint-chore)',
                        }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {modalError?.current && (
                <section className="rounded-xl border border-[var(--surface-separator)] p-3 space-y-3" aria-label={t('notes.savedVersion')}>
                  <p role="alert" className="text-footnote text-[var(--danger-text)]">{t('notes.changed')}</p>
                  <details open>
                    <summary className="min-h-[44px] flex items-center cursor-pointer text-headline">{t('notes.savedVersion')}</summary>
                    <p className="font-semibold [overflow-wrap:anywhere]">{modalError.current.title}</p>
                    <p className="text-subhead whitespace-pre-wrap [overflow-wrap:anywhere]">{modalError.current.body}</p>
                  </details>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-secondary min-h-[44px]" onClick={() => reviewConflict(true)}>{t('notes.keepDraft')}</button>
                    <button type="button" className="btn-secondary min-h-[44px]" onClick={() => reviewConflict(false)}>{t('notes.useSaved')}</button>
                  </div>
                </section>
              )}
              {modalState === 'add' && recoveryTarget && recoveryState === 'blocked' && (
                <button ref={repairButtonRef} type="button" className="btn-secondary min-h-[44px]" onClick={repairRecovery} disabled={saving}>{t('notes.repairRecovery')}</button>
              )}
              {modalError && !modalError.current && (
                <p role="alert" className="text-footnote text-[var(--danger-text)]">
                  {t(modalError.action === 'save' ? 'notes.errorSave' : 'notes.errorDelete')} {modalError.createRecovery ? modalError.raw ?? t(recoveryTarget ? recoveryState === 'blocked' ? 'notes.recoveryBlocked' : 'notes.durableRecovery' : 'notes.createRecovery') : modalError.raw ?? t(modalError.fallback)}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="mt-5 flex items-center justify-between border-t border-[var(--surface-separator)] pt-4">
              {modalState === 'edit' && (selectedNote?.can_delete ?? true) ? (
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
                  ref={saveButtonRef}
                  disabled={saving || loading || Boolean(modalError?.current) || Boolean(modalState === 'add' && recoveryTarget && recoveryState !== 'ready') || !formTitle.trim()}
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
