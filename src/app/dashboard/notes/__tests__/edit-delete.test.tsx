/**
 * @jest-environment jsdom
 */
// Notes (route inventory F-1): edit and delete go to /api/notes/[id]. They used
// to PATCH/DELETE /api/notes, which only has GET and POST, so nothing changed.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// A stable `t`, like the real provider's (the page refetches when `t` changes).
const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import NotesPage from '../page'

type Call = { url: string; method: string; body: unknown }
let calls: Call[] = []
// What a save/delete answers: a status + body, or a thrown network error.
let mutationReply: () => Promise<Response>

beforeEach(() => {
  calls = []
  mutationReply = async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as Response
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === '/api/notes' && method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ notes: [{ id: 'n 1', title: 'Wifi code', body: 'abc', color: 'yellow', created_at: '2026-09-01T00:00:00Z' }] }),
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

it('deleting DELETEs /api/notes/<id>', async () => {
  const user = userEvent.setup()
  render(<NotesPage />)
  await user.click(await screen.findByText('Wifi code'))
  await user.click(screen.getByRole('button', { name: 'notes.delete' }))
  await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  expect(calls.find((c) => c.method === 'DELETE')!.url).toBe('/api/notes/n%201')
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
