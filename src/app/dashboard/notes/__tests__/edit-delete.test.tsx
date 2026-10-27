/**
 * @jest-environment jsdom
 */
// Notes (route inventory F-1): edit and delete go to /api/notes/[id]. They used
// to PATCH/DELETE /api/notes, which only has GET and POST, so nothing changed.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let mockLocale: 'en' | 'es' = 'en'
const mockT = (key: string) => {
  if (mockLocale === 'es') {
    const spanish: Record<string, string> = {
      'notes.errorLoad': 'No se pudieron cargar las notas',
      'notes.retry': 'Reintentar',
      'notes.loading': 'Cargando notas...',
      'notes.errorSave': 'No se pudo guardar la nota.',
      'common.networkError': 'Comprueba la conexión.',
    }
    return spanish[key] ?? key
  }
  return key
}
// The provider can give the page a new translation function when its locale
// hydrates. The notes loader must remain stable across that render.
jest.mock('@/i18n', () => ({ useTranslation: () => ({ locale: mockLocale, t: (key: string) => mockT(key) }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureOffState: () => null,
}))
jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => true,
  useFeatures: () => ({ canManage: true }),
}))

let mockRecoveryAdopted = false
let mockRecoveryRows: Array<{ kind: 'note-create'; key: string; body: string; issuedAt: number }> = []
type MockRecoveryEntry = (typeof mockRecoveryRows)[number]
let mockFailStage = false, mockFailDismiss = false, mockUncertainStorage = false
const mockJournal = {
  initialize: jest.fn(async () => mockRecoveryRows),
  snapshot: jest.fn(async () => mockRecoveryRows),
  stage: jest.fn(async (entry) => { mockRecoveryRows = [entry]; if (mockFailStage) { mockUncertainStorage = true; throw new Error('Fixture stage fault') } }),
  inspect: jest.fn(async (_key, inspect) => inspect(mockRecoveryRows[0], { owner: { scope: 'a'.repeat(64) } })),
  send: jest.fn(async (_key, _review, send) => send(mockRecoveryRows[0], 'a'.repeat(64))),
  dismiss: jest.fn(async () => { mockRecoveryRows = []; if (mockFailDismiss) { mockUncertainStorage = true; throw new Error('Fixture cleanup fault') } }),
  hasUncertainStorage: () => mockUncertainStorage,
  recoverStorage: jest.fn(async () => { mockUncertainStorage = false; return mockRecoveryRows }),
}
jest.mock('@/lib/note-create-recovery-browser', () => ({
  browserNoteRecovery: () => mockJournal,
  noteIntentFromEntry: (entry: MockRecoveryEntry) => { const body = JSON.parse(entry.body); return { key: entry.key, body: entry.body, issuedAt: entry.issuedAt,
    context: { userId: body.expected_user_id, familyId: body.expected_family_id } } },
}))

import NotesPage from '../page'

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let notePermissions = { can_edit: true, can_delete: true }
let noteBody = 'abc'
let noteColor = 'yellow'
let noteUpdatedAt: string | undefined
// What a save/delete answers: a status + body, or a thrown network error.
let mutationReply: () => Promise<Response>

beforeEach(() => {
  calls = []
  mockRecoveryAdopted = false; mockRecoveryRows = []; mockFailStage = false; mockFailDismiss = false; mockUncertainStorage = false
  Object.values(mockJournal).forEach(value => { if (jest.isMockFunction(value)) value.mockClear() })
  noteBody = 'abc'
  noteColor = 'yellow'
  noteUpdatedAt = undefined
  mockLocale = 'en'
  notePermissions = { can_edit: true, can_delete: true }
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({ note: { id: 'new-note', family_id: 'family-a', created_by: 'account-a' } }) }) as Response
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/notes?limit=24' && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          writeContext: { userId: 'account-a', familyId: 'family-a' },
          recoveryAdopted: mockRecoveryAdopted,
          nextCursor: null,
          notes: [{
            id: 'n 1',
            title: 'Wifi code',
            body: noteBody,
            color: noteColor,
            created_at: '2026-09-01T00:00:00Z',
            ...(noteUpdatedAt ? { updated_at: noteUpdatedAt } : {}),
            ...notePermissions,
          }],
        }),
      } as Response
    }
    return mutationReply()
  }) as unknown as typeof fetch
})

it('saving an edit PATCHes /api/notes/<id>', async () => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true))
  const patch = calls.find((c) => c.method === 'PATCH')!
  expect(patch.url).toBe('/api/notes/n%201')
  expect(patch.body).toMatchObject({ id: 'n 1', title: 'Wifi code' })
})

it('keeps a note draft open and non-dismissible while saving', async () => {
  const user = userEvent.setup()
  let release!: () => void
  mutationReply = () => new Promise<Response>((resolve) => {
    release = () => resolve({ ok: true, status: 200, json: async () => ({ success: true }) } as Response)
  })

  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.save' }))

  expect((screen.getByRole('button', { name: 'common.saving' }) as HTMLButtonElement).disabled).toBe(true)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

  release()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('deleting DELETEs /api/notes/<id>', async () => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.delete' }))
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/notes/n%201')
})

it('keeps an open draft while a failed notes load is retried', async () => {
  const user = userEvent.setup()
  let getAttempts = 0
  let releaseRetry!: () => void
  const retryPending = new Promise<void>((resolve) => {
    releaseRetry = resolve
  })
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/notes?limit=24' && method === 'GET') {
      getAttempts += 1
      if (getAttempts === 1) {
        return { ok: false, status: 503, json: async () => ({}) } as Response
      }
      await retryPending
      return {
        ok: true,
        status: 200,
        json: async () => ({
          nextCursor: null,
          notes: [{
            id: 'recovered-note',
            title: 'Recovered note',
            body: 'Recovered after retry',
            color: 'yellow',
            created_at: '2026-09-01T00:00:00Z',
          }],
        }),
      } as Response
    }
    return mutationReply()
  }) as unknown as typeof fetch

  render(<NotesPage />)
  await user.click(await screen.findByRole('button', { name: 'notes.addNote' }))
  await user.type(screen.getByLabelText('notes.noteTitle'), 'Fridge note')
  await user.type(screen.getByLabelText('notes.noteBody'), 'Keep this draft')

  const retry = await screen.findByRole('button', { name: 'notes.retry' })
  await user.click(retry)
  const pending = screen.getByRole('button', { name: 'notes.loading' }) as HTMLButtonElement
  expect(pending.disabled).toBe(true)
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Fridge note')
  expect((screen.getByLabelText('notes.noteBody') as HTMLTextAreaElement).value).toBe('Keep this draft')
  expect(getAttempts).toBe(2)

  releaseRetry()
  await waitFor(() => expect(screen.getByText('Recovered note')).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'notes.retry' })).toBeNull()
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Fridge note')
})

it('keeps a failed load through locale hydration without refetching', async () => {
  const user = userEvent.setup()
  let getAttempts = 0
  let releaseRetry!: () => void
  const retryPending = new Promise<void>((resolve) => {
    releaseRetry = resolve
  })
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/notes?limit=24' && method === 'GET') {
      getAttempts += 1
      if (getAttempts === 1) {
        return { ok: false, status: 503, json: async () => ({}) } as Response
      }
      await retryPending
      return {
        ok: true,
        status: 200,
        json: async () => ({
          nextCursor: null,
          notes: [{
            id: 'locale-recovered',
            title: 'Recovered locale note',
            body: 'Recovered after locale hydration',
            color: 'yellow',
            created_at: '2026-09-01T00:00:00Z',
          }],
        }),
      } as Response
    }
    return mutationReply()
  }) as unknown as typeof fetch

  const { rerender } = render(<NotesPage />)
  await screen.findByRole('button', { name: 'notes.retry' })
  expect(getAttempts).toBe(1)

  mockLocale = 'es'
  rerender(<NotesPage />)
  expect(getAttempts).toBe(1)
  expect(screen.getAllByText('No se pudieron cargar las notas')).toHaveLength(2)
  const retry = screen.getByRole('button', { name: 'Reintentar' })
  await user.click(retry)
  const pending = screen.getByRole('button', { name: 'Cargando notas...' }) as HTMLButtonElement
  expect(pending.disabled).toBe(true)
  expect(getAttempts).toBe(2)

  releaseRetry()
  await waitFor(() => expect(screen.getByText('Recovered locale note')).toBeTruthy())
  expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull()
})

describe('failures are shown in the modal, which stays open with the text', () => {
  it("a failed save shows the server's error", async () => {
    mutationReply = async () => ({ ok: false, status: 400, json: async () => ({ error: 'Title is too long' }) }) as Response
    const user = userEvent.setup()
    render(<NotesPage />)
    await user.click(await screen.findByText('Wifi code'))
    await user.clear(screen.getByLabelText('notes.noteTitle'))
    await user.type(screen.getByLabelText('notes.noteTitle'), 'Guest wifi')
    await user.click(screen.getByRole('button', { name: 'notes.save' }))

    expect((await screen.findByRole('alert')).textContent).toBe('notes.errorSave Title is too long')
    expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Guest wifi')
    expect((screen.getByRole('button', { name: 'notes.save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('an uncertain create retains its exact-request recovery draft', async () => {
    mutationReply = async () => {
      throw new TypeError('Failed to fetch')
    }
    const user = userEvent.setup()
    render(<NotesPage />)
    await user.click(await screen.findByRole('button', { name: 'notes.addNote' }))
    await user.type(screen.getByLabelText('notes.noteTitle'), 'Dentist')
    await user.click(screen.getByRole('button', { name: 'notes.save' }))

    expect((await screen.findByRole('alert')).textContent).toBe('notes.errorSave notes.createRecovery')
    expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Dentist')
  })

  it('a failed delete shows an error and keeps the note open', async () => {
    mutationReply = async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response
    const user = userEvent.setup()
    render(<NotesPage />)
    await user.click(await screen.findByText('Wifi code'))
    await user.click(screen.getByRole('button', { name: 'notes.delete' }))

    expect((await screen.findByRole('alert')).textContent).toBe('notes.errorDelete common.tryAgain')
    expect((screen.getByRole('button', { name: 'notes.delete' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('D9 ownership controls come from the API DTO', () => {
  it('lets a member edit their own note without offering delete', async () => {
    notePermissions = { can_edit: true, can_delete: false }
    const user = userEvent.setup()
    render(<NotesPage />)

    await user.click(await screen.findByText('Wifi code'))
    expect(screen.getByRole('button', { name: 'notes.save' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'notes.delete' })).toBeNull()
  })

  it('keeps another member note readable but non-editable', async () => {
    notePermissions = { can_edit: false, can_delete: false }
    render(<NotesPage />)

    const title = await screen.findByText('Wifi code')
    expect(title.closest('[role="button"]')).toBeNull()
    expect(screen.queryByRole('button', { name: 'notes.delete' })).toBeNull()
  })
})


it('opens the complete read-only note without exposing edit or delete and restores focus', async () => {
  notePermissions = { can_edit: false, can_delete: false }
  noteBody = 'First line\n' + 'Long shared information '.repeat(60) + '\nLast line'
  const user = userEvent.setup()
  render(<NotesPage />)
  const opener = await screen.findByRole('button', { name: 'notes.readNote: Wifi code' })
  await user.click(opener)
  const dialog = screen.getByRole('dialog')
  expect(dialog.textContent).toContain(noteBody)
  expect(dialog.querySelector('input, textarea')).toBeNull()
  expect(screen.queryByRole('button', { name: 'notes.save' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'notes.delete' })).toBeNull()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
  expect(calls.map((call) => call.method)).toEqual(['GET'])
})

it('uses one Add entrypoint and includes all five canonical colors', async () => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await screen.findByText('Wifi code')
  expect(screen.getAllByRole('button', { name: 'notes.addNote' })).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'notes.newNote' })).toBeNull()
  await user.click(screen.getByRole('button', { name: 'notes.addNote' }))
  for (const color of ['Yellow', 'Pink', 'Blue', 'Green', 'Purple']) {
    expect(screen.getByRole('button', { name: 'notes.color' + color })).toBeTruthy()
  }
})

it.each([{ notes: {} }, { notes: [{ id: 'unknown-color', title: 'Invalid', body: 'Body', color: 'not-a-canonical-color', created_at: '2026-09-01T00:00:00Z' }] }, { notes: Array(2).fill({ id: 'duplicate', title: 'Valid note', body: 'Body', color: 'yellow', created_at: '2026-09-01T00:00:00Z' }) }])('rejects malformed notes instead of fabricating an empty household', async (body) => {
  const fetchOriginal = global.fetch
  let attempt = 0
  global.fetch = jest.fn(async (input, init) => {
    if (attempt++ === 0) return { ok: true, status: 200, json: async () => body } as Response
    return fetchOriginal(input, init)
  }) as typeof fetch
  const user = userEvent.setup()
  render(<NotesPage />)
  await screen.findByRole('button', { name: 'notes.retry' })
  expect(screen.queryByText('notes.empty')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'notes.retry' }))
  await screen.findByText('Wifi code')
})

it('records a confirmed save when refresh fails and retries only the read', async () => {
  const fetchOriginal = global.fetch
  let reads = 0
  global.fetch = jest.fn(async (input, init) => {
    if (String(input) === '/api/notes?limit=24' && !init?.method && ++reads === 2) return { ok: false, status: 503, json: async () => ({}) } as Response
    return fetchOriginal(input, init)
  }) as typeof fetch
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await screen.findByText('notes.savedRefreshFailed')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'notes.retry' }))
  await screen.findByText('Wifi code')
  expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
  expect(screen.queryByText('notes.savedRefreshFailed')).toBeNull()
})

it('retranslates a retained network error without replaying the mutation or losing its draft', async () => {
  mutationReply = async () => { throw new TypeError('offline') }
  const user = userEvent.setup()
  const { rerender } = render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await screen.findByRole('alert')
  mockLocale = 'es'
  rerender(<NotesPage />)
  expect(screen.getByRole('alert').textContent).toBe('No se pudo guardar la nota. Comprueba la conexión.')
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Wifi code')
  expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
})


it.each([['green', 'Green'], ['purple', 'Purple']])('preserves canonical %s when editing an existing note', async (color, label) => {
  noteColor = color
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  expect(screen.getByRole('button', { name: 'notes.color' + label }).getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true))
  expect(calls.find((call) => call.method === 'PATCH')?.body).toMatchObject({ color })
})


it('keeps a successful save announcement outside the note cards', async () => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await screen.findByText('notes.saved')
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  expect(screen.getByTestId('note-card').querySelector('[role="status"]')).toBeNull()
})

it('offers household setup instead of a form after the canonical missing-family refusal', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'You must belong to a family' }) } as Response)) as typeof fetch
  render(<NotesPage />)
  await screen.findByText('notes.chooseHousehold')
  expect(screen.queryByRole('button', { name: 'notes.addNote' })).toBeNull()
  expect(screen.getByRole('link', { name: 'notes.createHousehold' }).getAttribute('href')).toBe('/dashboard/family/create')
  expect(screen.getByRole('link', { name: 'notes.joinHousehold' }).getAttribute('href')).toBe('/join')
})


it('closes an early Add draft if the pending initial load discovers no household', async () => {
  let release!: (reply: Response) => void
  const pending = new Promise<Response>((resolve) => { release = resolve })
  global.fetch = jest.fn(() => pending) as typeof fetch
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(screen.getByRole('button', { name: 'notes.addNote' }))
  await user.type(screen.getByLabelText('notes.noteTitle'), 'Unsaved household draft')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'notes.save' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => release({ ok: false, status: 400, json: async () => ({ error: 'You must belong to a family' }) } as Response))
  await screen.findByText('notes.chooseHousehold')
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByRole('button', { name: 'notes.addNote' })).toBeNull()
  expect(global.fetch).toHaveBeenCalledTimes(1)
})


it('returns Cancel to Add after dismissing an earlier success notice', async () => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await screen.findByText('notes.saved')
  const opener = screen.getByRole('button', { name: 'notes.addNote' })
  await user.click(opener)
  expect(screen.queryByText('notes.saved')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'notes.cancel' }))
  expect(document.activeElement).toBe(opener)
})

// Authored/unrun: current web requires bounded notes pages, including retries.
const pagedNote = (id: string) => ({ id, title: id, body: 'Fixture', color: 'yellow', created_at: '2026-10-24T12:00:00Z', can_edit: false, can_delete: false })
const notesReply = (notes: ReturnType<typeof pagedNote>[], nextCursor: string | null) => ({ ok: true, status: 200, json: async () => ({ notes, nextCursor }) }) as Response

it('replaces each page, returns to previous/newest notes, and retries an exact failed cursor', async () => {
  const user = userEvent.setup()
  const urls: string[] = []
  let olderReads = 0
  global.fetch = jest.fn(async (input) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('cursor=')) {
      if (++olderReads === 1) return { ok: false, status: 503, json: async () => ({}) } as Response
      return notesReply([pagedNote('Older note')], null)
    }
    return notesReply(Array.from({ length: 24 }, (_, i) => pagedNote(`Recent ${i}`)), 'fixture-next')
  }) as typeof fetch
  render(<NotesPage />)
  await screen.findByText('Recent 0')
  expect(screen.getAllByTestId('note-card')).toHaveLength(24)
  await user.click(screen.getByRole('button', { name: 'notes.older' }))
  await screen.findByRole('button', { name: 'notes.retry' })
  await user.click(screen.getByRole('button', { name: 'notes.retry' }))
  await screen.findByText('Older note')
  expect(screen.queryByText('Recent 0')).toBeNull()
  expect(urls.slice(-2)).toEqual(['/api/notes?limit=24&cursor=fixture-next', '/api/notes?limit=24&cursor=fixture-next'])
  await user.click(screen.getByRole('button', { name: 'notes.previous' }))
  await screen.findByText('Recent 0')
  await user.click(screen.getByRole('button', { name: 'notes.older' }))
  await screen.findByText('Older note')
  await user.click(screen.getByRole('button', { name: 'notes.newest' }))
  await screen.findByText('Recent 0')
  expect(screen.queryByRole('button', { name: 'notes.previous' })).toBeNull()
})

it.each([
  { notes: [pagedNote('Legacy note')] },
  { notes: Array.from({ length: 25 }, (_, i) => pagedNote(`Too many ${i}`)), nextCursor: null },
  { notes: [pagedNote('Incomplete page')], nextCursor: 'fixture-next' },
])('rejects old or malformed page envelopes instead of claiming a complete list', async (body) => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => body })) as unknown as typeof fetch
  render(<NotesPage />)
  await screen.findByRole('button', { name: 'notes.retry' })
  expect(screen.queryByTestId('note-card')).toBeNull()
})

it('ends a stalled response-body read without allowing its late notes to replace recovery', async () => {
  jest.useFakeTimers()
  try {
    let release!: (body: unknown) => void
    global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: () => new Promise(resolve => { release = resolve }) })) as unknown as typeof fetch
    render(<NotesPage />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { jest.advanceTimersByTime(15_000) })
    expect(screen.getByRole('button', { name: 'notes.retry' })).toBeTruthy()
    await act(async () => { release({ notes: [pagedNote('Late note')], nextCursor: null }) })
    expect(screen.queryByText('Late note')).toBeNull()
    expect(screen.getByRole('button', { name: 'notes.retry' })).toBeTruthy()
  } finally {
    jest.useRealTimers()
  }
})

// Authored only: conflict resolution retains the mounted draft and never auto-saves.
it.each([true, false])('reviews saved content before re-saving a conflicting draft (keep=%s)', async keepDraft => {
  const user = userEvent.setup();
  noteUpdatedAt = '2026-09-01T00:00:00.000Z';
  const current = { id: 'n 1', title: 'Latest title', body: 'Latest saved body', color: 'blue',
    created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-25T12:00:00.000Z' };
  mutationReply = async () => ({ ok: false, status: 409, json: async () => ({ error: { code: 'NOTE_CHANGED' }, current }) }) as Response;
  render(<NotesPage />);
  await user.click(await screen.findByText('Wifi code'));
  await user.clear(screen.getByLabelText('notes.noteTitle'));
  await user.type(screen.getByLabelText('notes.noteTitle'), 'My draft');
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('notes.changed');
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('My draft');
  expect((screen.getByRole('button', { name: 'notes.save' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('Latest saved body')).toBeTruthy();
  expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: keepDraft ? 'notes.keepDraft' : 'notes.useSaved' }));
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe(keepDraft ? 'My draft' : current.title);
  expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(1);
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({ note: current }) }) as Response;
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  await waitFor(() => expect(calls.filter(call => call.method === 'PATCH')).toHaveLength(2));
  const writes = calls.filter(call => call.method === 'PATCH');
  expect(writes[0].body).toEqual(expect.objectContaining({ expected_updated_at: noteUpdatedAt }));
  expect(writes[1].body).toEqual(expect.objectContaining({ expected_updated_at: current.updated_at, title: keepDraft ? 'My draft' : current.title }));
});

it('retries an uncertain create with the same bytes/key and keeps that draft on reopen', async () => {
  const user = userEvent.setup();
  mutationReply = async () => { throw new TypeError('Fixture lost response') };
  render(<NotesPage />);
  await user.click(await screen.findByRole('button', { name: 'notes.addNote' }));
  await user.type(screen.getByLabelText('notes.noteTitle'), 'Original create');
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  expect((await screen.findByRole('alert')).textContent).toContain('notes.createRecovery');
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).readOnly).toBe(true);
  await user.click(screen.getByRole('button', { name: 'notes.cancel' }));
  await user.click(screen.getByRole('button', { name: 'notes.addNote' }));
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Original create');
  mutationReply = async () => calls[calls.length - 1].url.endsWith('/receipt')
    ? ({ ok: true, status: 200, json: async () => ({ state: 'unissued' }) }) as Response
    : ({ ok: true, status: 201, json: async () => ({ note: { id: 'created-note', family_id: 'family-a', created_by: 'account-a' } }) }) as Response;
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  await waitFor(() => expect(calls.filter(call => call.method === 'POST' && call.url === '/api/notes')).toHaveLength(2));
  const posts = jest.mocked(fetch).mock.calls.filter(([url, init]) => init?.method === 'POST' && String(url) === '/api/notes');
  expect(posts[0][1]?.body).toBe(posts[1][1]?.body);
  expect(new Headers(posts[0][1]?.headers).get('Idempotency-Key')).toBe(new Headers(posts[1][1]?.headers).get('Idempotency-Key'));
});

it('finishes removed-note recovery without recreating the original note', async () => {
  const user = userEvent.setup();
  mutationReply = async () => { throw new TypeError('Fixture lost response') };
  render(<NotesPage />);
  await user.click(await screen.findByRole('button', { name: 'notes.addNote' }));
  await user.type(screen.getByLabelText('notes.noteTitle'), 'Removed later');
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  await screen.findByRole('alert');
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({ state: 'removed', noteId: 'old-note' }) }) as Response;
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  expect(await screen.findByText('notes.createRemoved')).toBeTruthy();
  expect(calls.filter(call => call.method === 'POST' && call.url === '/api/notes')).toHaveLength(1);
  expect(calls.filter(call => call.url === '/api/notes/create/receipt')).toHaveLength(1);
  expect(screen.queryByLabelText('notes.noteTitle')).toBeNull();
});

function recoveredFixture() {
  return { kind: 'note-create' as const, key: 'restored-note-fixture-key-001', issuedAt: Date.now(), body: JSON.stringify({
    title: 'Restored request', body: 'Original stored content', color: 'yellow', expected_user_id: 'account-a', expected_family_id: 'family-a',
  }) };
}
it('reviews a restored journal and settles present proof without another create', async () => {
  mockRecoveryAdopted = true; mockRecoveryRows = [recoveredFixture()];
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({ state: 'present', noteId: 'saved-note' }) }) as Response;
  const user = userEvent.setup(); render(<NotesPage />);
  await user.click(await screen.findByRole('button', { name: 'notes.reviewRecovery' }));
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Restored request');
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).readOnly).toBe(true);
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  expect(await screen.findByText('notes.saved')).toBeTruthy();
  expect(calls.filter(call => call.url === '/api/notes' && call.method === 'POST')).toHaveLength(0);
  expect(mockJournal.dismiss).toHaveBeenCalledWith('restored-note-fixture-key-001');
});
it.each(['stage', 'cleanup'])('holds an adopted %s fault and repairs without an automatic send', async fault => {
  mockRecoveryAdopted = true; mockFailStage = fault === 'stage'; mockFailDismiss = fault === 'cleanup';
  mutationReply = async () => calls[calls.length - 1].url.endsWith('/receipt')
    ? ({ ok: true, status: 200, json: async () => ({ state: 'unissued' }) }) as Response
    : ({ ok: true, status: 201, json: async () => {
      // The request is already staged before the first application write.
      expect(mockRecoveryRows).toHaveLength(1);
      return { note: { id: 'saved-note', family_id: 'family-a', created_by: 'account-a' } };
    } }) as Response;
  const user = userEvent.setup(); render(<NotesPage />);
  const add = await screen.findByRole('button', { name: 'notes.addNote' });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  await user.click(add); await user.type(screen.getByLabelText('notes.noteTitle'), 'Durable request');
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  const dialog = screen.getByRole('dialog');
  const repair = await within(dialog).findByRole('button', { name: 'notes.repairRecovery' });
  expect(calls.filter(call => call.url === '/api/notes' && call.method === 'POST')).toHaveLength(fault === 'stage' ? 0 : 1);
  mockFailStage = false; mockFailDismiss = false;
  await user.click(repair);
  expect(mockJournal.recoverStorage).toHaveBeenCalledTimes(1);
  expect(calls.filter(call => call.url === '/api/notes' && call.method === 'POST')).toHaveLength(fault === 'stage' ? 0 : 1);
  if (fault === 'stage') await user.click(screen.getByRole('button', { name: 'notes.save' }));
  expect(await screen.findByText('notes.saved')).toBeTruthy();
  expect(calls.filter(call => call.url === '/api/notes' && call.method === 'POST')).toHaveLength(1);
});

it('clears the visible recovered draft on owner change without erasing its journal', async () => {
  mockRecoveryAdopted = true; mockRecoveryRows = [recoveredFixture()];
  const original = mockRecoveryRows[0];
  const user = userEvent.setup(); render(<NotesPage />);
  await user.click(await screen.findByRole('button', { name: 'notes.reviewRecovery' }));
  mockJournal.inspect.mockRejectedValueOnce(Object.assign(new Error('Fixture owner changed'), { reason: 'OWNER_CHANGED' }));
  await user.click(screen.getByRole('button', { name: 'notes.save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByDisplayValue('Original stored content')).toBeNull();
  expect(mockRecoveryRows).toEqual([original]);
  expect(mockJournal.dismiss).not.toHaveBeenCalled();
  expect(calls.filter(call => call.url === '/api/notes' && call.method === 'POST')).toHaveLength(0);
});

// Authored source coverage only; execution is deferred with the current no-QA scope.
it.each(['save', 'delete'] as const)('keeps the note sheet after an oversized %s reply without decoding it', async (action) => {
  const decode = jest.fn(async () => ({ success: true }))
  mutationReply = async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '1048576' }), json: decode }) as unknown as Response
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: `notes.${action}` }))
  await screen.findByRole('alert')
  expect(decode).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect((screen.getByLabelText('notes.noteTitle') as HTMLInputElement).value).toBe('Wifi code')
  expect((screen.getByRole('button', { name: `notes.${action}` }) as HTMLButtonElement).disabled).toBe(false)
  expect(calls.filter(call => call.method === (action === 'save' ? 'PATCH' : 'DELETE'))).toHaveLength(1)
})

it('refuses an oversized notes page before decoding and offers recovery', async () => {
  const decode = jest.fn(async () => ({ notes: [pagedNote('Oversized note')], nextCursor: null }))
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, headers: new Headers({ 'content-length': '3145728' }), json: decode })) as unknown as typeof fetch
  render(<NotesPage />)
  await screen.findByRole('button', { name: 'notes.retry' })
  expect(decode).not.toHaveBeenCalled()
  expect(screen.queryByTestId('note-card')).toBeNull()
})

it.each([401, 403])('clears an existing personal note view on %s without decoding its error body', async (status) => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  const decode = jest.fn(() => new Promise(() => {}))
  global.fetch = jest.fn(async (_input, init) => init?.method === 'PATCH'
    ? ({ ok: true, status: 200, json: async () => ({ success: true }) })
    : ({ ok: false, status, json: decode })) as unknown as typeof fetch
  await user.click(screen.getByRole('button', { name: 'notes.save' }))
  await screen.findByRole('button', { name: 'notes.retry' })
  expect(decode).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByTestId('note-card')).toBeNull()
})
