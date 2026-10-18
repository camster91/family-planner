/**
 * @jest-environment jsdom
 */
// The header Print button used to print the "Select a card to preview"
// placeholder when no card was open. With nothing previewed it now prints every
// card; with a card previewed it prints just that one.
import * as React from 'react'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockT = (key: string) => key
jest.mock('@/i18n', () => ({ useTranslation: () => ({ t: mockT }) }))
jest.mock('@/components/ui/feature-gate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import EmergencyPage from '../page'

const contact = (id: string, name: string) => ({
  id,
  person_id: null,
  person_name: name,
  relationship: 'child',
  blood_type: null,
  allergies: `${name} allergy`,
  medications: null,
  medical_conditions: null,
  doctor_name: null,
  doctor_phone: null,
  dentist_name: null,
  dentist_phone: null,
  insurance_provider: null,
  insurance_id: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
})

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response

let printSpy: jest.SpyInstance
let mutationReply: () => Promise<Response>

beforeEach(() => {
  printSpy = jest.spyOn(window, 'print').mockImplementation(() => {})
  mutationReply = async () => reply({})
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if ((init?.method ?? 'GET') !== 'GET') return mutationReply()
    if (url === '/api/emergency-contacts') return reply({ contacts: [contact('c1', 'Sam'), contact('c2', 'Alex')] })
    return reply({})
  }) as unknown as typeof fetch
})

afterEach(() => printSpy.mockRestore())

const printCards = () => Array.from(document.querySelectorAll<HTMLElement>('.print-card'))

it('prints every card when none is previewed', async () => {
  const user = userEvent.setup()
  render(<EmergencyPage />)
  await screen.findAllByText('Sam')

  const cards = printCards()
  expect(cards).toHaveLength(1)
  expect(cards[0]).toBe(screen.getByTestId('emergency-print-all'))
  expect(cards[0].textContent).toContain('Sam allergy')
  expect(cards[0].textContent).toContain('Alex allergy')
  // The on-screen placeholder is never part of the printout.
  expect(cards[0].textContent).not.toContain('emergency.selectPreview')
  expect(screen.getByText('emergency.selectPreview').closest('.no-print')).not.toBeNull()

  const headerPrint = screen.getByRole('button', { name: 'emergency.print' })
  expect(headerPrint.className).toMatch(/min-h-\[44px\]/)
  await user.click(headerPrint)
  expect(printSpy).toHaveBeenCalledTimes(1)
})

it('prints only the previewed card when one is open', async () => {
  const user = userEvent.setup()
  render(<EmergencyPage />)
  await user.click((await screen.findAllByText('Alex'))[0])

  expect(screen.queryByTestId('emergency-print-all')).toBeNull()
  const cards = printCards()
  expect(cards).toHaveLength(1)
  expect(cards[0]).toBe(screen.getByTestId('emergency-preview'))
  expect(within(cards[0]).getByText('Alex allergy')).toBeTruthy()
  expect(cards[0].textContent).not.toContain('Sam allergy')
})

it('keeps the emergency draft open and non-dismissible while saving', async () => {
  const user = userEvent.setup()
  let release!: () => void
  mutationReply = () => new Promise<Response>((resolve) => {
    release = () => resolve(reply({ contacts: [contact('c1', 'Sam')] }))
  })

  render(<EmergencyPage />)
  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('emergency.personName')))
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  expect(screen.getByText('emergency.nameRequired')).toBeTruthy()
  expect((global.fetch as jest.Mock).mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  await user.type(screen.getByLabelText('emergency.personName'), 'Jordan')
  await user.click(screen.getByRole('button', { name: 'common.save' }))

  expect((screen.getByRole('button', { name: 'common.saving' }) as HTMLButtonElement).disabled).toBe(true)
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()

  release()
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('releases the save latch before a post-commit refresh settles', async () => {
  const user = userEvent.setup()
  let contactReads = 0
  let refreshStarted = false
  let finishRefresh!: (response: Response) => void
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (url === '/api/emergency-contacts' && (init?.method ?? 'GET') === 'GET') {
      contactReads += 1
      if (contactReads === 1) return reply({ contacts: [contact('c1', 'Sam')] })
      refreshStarted = true
      return new Promise<Response>((resolve) => { finishRefresh = resolve })
    }
    if (url === '/api/emergency-contacts' && init?.method === 'POST') {
      return reply({ contact: contact('c3', 'Jordan') })
    }
    return reply({})
  }) as unknown as typeof fetch

  render(<EmergencyPage />)
  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Jordan')
  await user.click(screen.getByRole('button', { name: 'common.save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(screen.queryByRole('button', { name: 'common.saving' })).toBeNull()
  expect(screen.getAllByText('Jordan').length).toBeGreaterThan(0)
  expect(refreshStarted).toBe(true)

  finishRefresh(reply({ contacts: [contact('c1', 'Sam'), contact('c3', 'Jordan')] }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('keeps the committed rows and offers refresh retry after a successful save', async () => {
  const user = userEvent.setup()
  let contactReads = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (url === '/api/emergency-contacts' && (init?.method ?? 'GET') === 'GET') {
      contactReads += 1
      return contactReads === 1
        ? reply({ contacts: [contact('c1', 'Sam')] })
        : reply({ error: 'refresh failed' }, false)
    }
    if (url === '/api/emergency-contacts' && init?.method === 'POST') {
      return reply({ contact: contact('c3', 'Jordan') })
    }
    return reply({})
  }) as unknown as typeof fetch

  render(<EmergencyPage />)
  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Jordan')
  await user.click(screen.getByRole('button', { name: 'common.save' }))

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect((await screen.findByRole('alert')).textContent).toContain('common.error')
  expect(screen.getAllByText('Jordan').length).toBeGreaterThan(0)
  expect(screen.getByRole('button', { name: 'common.tryAgain' })).toBeTruthy()
})

it('ignores a refresh started before a later committed mutation', async () => {
  const user = userEvent.setup()
  let contactReads = 0
  let mutations = 0
  const refreshes: Array<(response: Response) => void> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (url === '/api/emergency-contacts' && (init?.method ?? 'GET') === 'GET') {
      contactReads += 1
      if (contactReads === 1) return reply({ contacts: [contact('c1', 'Sam')] })
      return new Promise<Response>((resolve) => { refreshes.push(resolve) })
    }
    if (url === '/api/emergency-contacts' && init?.method === 'POST') {
      mutations += 1
      const name = mutations === 1 ? 'Jordan' : 'Taylor'
      return reply({ contact: contact(`c${mutations + 1}`, name) })
    }
    return reply({})
  }) as unknown as typeof fetch

  render(<EmergencyPage />)
  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Jordan')
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(refreshes).toHaveLength(1))

  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Taylor')
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(refreshes).toHaveLength(2))

  refreshes[0](reply({ contacts: [contact('c1', 'Sam'), contact('c2', 'Jordan')] }))
  await waitFor(() => expect(screen.getAllByText('Taylor').length).toBeGreaterThan(0))
  expect(screen.getAllByText('Jordan').length).toBeGreaterThan(0)

  refreshes[1](reply({
    contacts: [contact('c1', 'Sam'), contact('c2', 'Jordan'), contact('c3', 'Taylor')],
  }))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

it('lets a manual retry supersede an older background read', async () => {
  const user = userEvent.setup()
  let contactReads = 0
  let mutations = 0
  let finishOldRead!: (response: Response) => void
  let finishRetry!: (response: Response) => void
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (url === '/api/emergency-contacts' && (init?.method ?? 'GET') === 'GET') {
      contactReads += 1
      if (contactReads === 1) return reply({ contacts: [contact('c1', 'Sam')] })
      if (contactReads === 2) {
        return new Promise<Response>((resolve) => { finishOldRead = resolve })
      }
      if (contactReads === 3) return reply({ error: 'stale refresh failed' }, false)
      return new Promise<Response>((resolve) => { finishRetry = resolve })
    }
    if (url === '/api/emergency-contacts' && init?.method === 'POST') {
      mutations += 1
      const name = mutations === 1 ? 'Jordan' : 'Taylor'
      return reply({ contact: contact(`c${mutations + 1}`, name) })
    }
    return reply({})
  }) as unknown as typeof fetch

  render(<EmergencyPage />)
  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Jordan')
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(contactReads).toBe(2))

  await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
  await user.type(screen.getByLabelText('emergency.personName'), 'Taylor')
  await user.click(screen.getByRole('button', { name: 'common.save' }))
  await waitFor(() => expect(contactReads).toBe(3))
  await screen.findByRole('alert')

  await user.click(screen.getByRole('button', { name: 'common.tryAgain' }))
  await waitFor(() => expect(contactReads).toBe(4))
  finishRetry(reply({
    contacts: [contact('c1', 'Sam'), contact('c2', 'Jordan'), contact('c3', 'Taylor')],
  }))
  await waitFor(() => expect(screen.getAllByText('Taylor').length).toBeGreaterThan(0))

  finishOldRead(reply({ contacts: [contact('c1', 'Sam'), contact('c2', 'Jordan')] }))
  await waitFor(() => expect(screen.getAllByText('Taylor').length).toBeGreaterThan(0))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('keeps a failed deletion retryable, prevents duplicate deletes and restores focus after confirmation', async () => {
  const user = userEvent.setup()
  let deleted = false
  let finishDelete!: (response: Response) => void
  const deleteRequests: string[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/auth/me') return reply({ user: { id: 'p1', role: 'parent' } })
    if (init?.method === 'DELETE') {
      deleteRequests.push(url)
      return new Promise<Response>((resolve) => { finishDelete = resolve })
    }
    return reply({ contacts: deleted ? [contact('c2', 'Alex')] : [contact('c1', 'Sam'), contact('c2', 'Alex')] })
  }) as unknown as typeof fetch
  render(<EmergencyPage />)
  await user.click((await screen.findAllByText('Sam'))[0])
  await user.click(screen.getByRole('button', { name: 'emergency.editCard' }))
  await user.click(screen.getByRole('button', { name: 'emergency.delete' }))
  const confirmation = screen.getByRole('alertdialog')
  await user.dblClick(within(confirmation).getByRole('button', { name: 'emergency.delete' }))
  expect(deleteRequests).toEqual(['/api/emergency-contacts/c1'])
  await user.keyboard('{Escape}')
  expect(screen.getByRole('alertdialog')).toBeTruthy()
  finishDelete(reply({ error: 'not deleted' }, false))
  await waitFor(() => expect(within(confirmation).getByRole('button', { name: 'emergency.delete' }).hasAttribute('disabled')).toBe(false))
  expect(screen.getByLabelText('emergency.personName')).toHaveProperty('value', 'Sam')
  await user.click(within(confirmation).getByRole('button', { name: 'emergency.delete' }))
  deleted = true
  finishDelete(reply({ ok: true }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'emergency.addCard' })))
  expect(screen.queryByText('Sam')).toBeNull()
  expect(deleteRequests).toHaveLength(2)
})


it('keeps optional-section summaries in the dialog keyboard path', async () => {
  const user = userEvent.setup()
  const visibility = jest.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement })
  try {
    render(<EmergencyPage />)
    await user.click(await screen.findByRole('button', { name: 'emergency.addCard' }))
    const summary = screen.getByText('emergency.groups.medical', { selector: 'summary' })
    await user.click(summary)
    summary.focus()
    expect(fireEvent.keyDown(summary, { key: 'Tab' })).toBe(true)
    expect(document.activeElement).toBe(summary)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByLabelText('emergency.bloodType'))
  } finally {
    visibility.mockRestore()
  }
})
