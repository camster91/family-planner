/**
 * @jest-environment jsdom
 */
// Notes (route inventory F-1): edit and delete go to /api/notes/[id]. They used
// to PATCH/DELETE /api/notes, which only has GET and POST, so nothing changed.
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
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

import NotesPage from '../page'

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
let notePermissions = { can_edit: true, can_delete: true }
let noteBody = 'abc'
let noteColor = 'yellow'
// What a save/delete answers: a status + body, or a thrown network error.
let mutationReply: () => Promise<Response>

beforeEach(() => {
  calls = []
  noteBody = 'abc'
  noteColor = 'yellow'
  mockLocale = 'en'
  notePermissions = { can_edit: true, can_delete: true }
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as Response
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/notes' && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          notes: [{
            id: 'n 1',
            title: 'Wifi code',
            body: noteBody,
            color: noteColor,
            created_at: '2026-09-01T00:00:00Z',
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
    if (url === '/api/notes' && method === 'GET') {
      getAttempts += 1
      if (getAttempts === 1) {
        return { ok: false, status: 503, json: async () => ({}) } as Response
      }
      await retryPending
      return {
        ok: true,
        status: 200,
        json: async () => ({
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
    if (url === '/api/notes' && method === 'GET') {
      getAttempts += 1
      if (getAttempts === 1) {
        return { ok: false, status: 503, json: async () => ({}) } as Response
      }
      await retryPending
      return {
        ok: true,
        status: 200,
        json: async () => ({
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

  it('a save that cannot reach the server says to check the connection', async () => {
    mutationReply = async () => {
      throw new TypeError('Failed to fetch')
    }
    const user = userEvent.setup()
    render(<NotesPage />)
    await user.click(await screen.findByRole('button', { name: 'notes.addNote' }))
    await user.type(screen.getByLabelText('notes.noteTitle'), 'Dentist')
    await user.click(screen.getByRole('button', { name: 'notes.save' }))

    expect((await screen.findByRole('alert')).textContent).toBe('notes.errorSave common.networkError')
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
    if (String(input) === '/api/notes' && !init?.method && ++reads === 2) return { ok: false, status: 503, json: async () => ({}) } as Response
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
