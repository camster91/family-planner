/**
 * @jest-environment jsdom
 */
// Command palette → household search (route inventory F-3): a parent can hand
// the typed words to /dashboard/search; a teen or child, who cannot open that
// page, is never offered it.
import * as React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultFeatures } from '@/lib/features'
import CommandPalette from '../CommandPalette'
import { I18nProvider } from '@/i18n'

const mockPush = jest.fn()
jest.mock('@/components/providers/features-provider', () => ({
  useFeatures: () => ({ features: defaultFeatures() }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}))

beforeEach(() => mockPush.mockReset())

const input = () => screen.getByRole('textbox', { name: 'Search or go to a page' })

// Authored/unrun: advertised keyboard navigation uses currently rendered,
// role/feature-filtered destinations, without changing the search draft.
it('moves through destinations with arrow keys and activates the focused destination with Enter', async () => {
  const user = userEvent.setup()
  render(<CommandPalette open onClose={() => undefined} role="parent" />)
  await waitFor(() => expect(document.activeElement).toBe(input()))
  const destinations = Array.from(screen.getByRole('dialog').querySelectorAll<HTMLButtonElement>('[data-command-destination]'))
  expect(destinations.length).toBeGreaterThan(0)
  await user.keyboard('{ArrowDown}')
  expect(document.activeElement).toBe(destinations[0])
  await user.keyboard('{ArrowUp}')
  expect(document.activeElement).toBe(destinations[destinations.length - 1])
  await user.keyboard('{Enter}')
  expect(mockPush).toHaveBeenCalledTimes(1)
  expect((input() as HTMLInputElement).value).toBe('')
})

it('keeps Tab and Shift+Tab within the open palette', async () => {
  const user = userEvent.setup()
  render(<><button>Outside palette</button><CommandPalette open onClose={() => undefined} role="parent" /></>)
  await waitFor(() => expect(document.activeElement).toBe(input()))
  const destinations = Array.from(screen.getByRole('dialog').querySelectorAll<HTMLButtonElement>('[data-command-destination]'))
  const last = destinations[destinations.length - 1]
  await user.tab({ shift: true })
  expect(document.activeElement).toBe(last)
  await user.tab()
  expect(document.activeElement).toBe(input())
})

it('does not treat an IME confirmation Enter as a household search submission', async () => {
  const user = userEvent.setup()
  render(<CommandPalette open onClose={() => undefined} role="parent" />)
  await user.type(input(), 'unmatchedhouseholdquery')
  fireEvent.keyDown(input(), { key: 'Enter', isComposing: true })
  expect(mockPush).not.toHaveBeenCalled()
})

it('offers a parent "Search the household" and opens the search page with the words', async () => {
  const user = userEvent.setup()
  const onClose = jest.fn()
  render(<CommandPalette open onClose={onClose} role="parent" />)
  await user.type(input(), 'oat  milk')
  await user.click(screen.getByRole('button', { name: /Search the household for “oat milk”/ }))
  expect(mockPush).toHaveBeenCalledWith('/dashboard/search?q=oat%20milk')
  expect(onClose).toHaveBeenCalled()
})

it('Enter searches when no page name matches', async () => {
  const user = userEvent.setup()
  render(<CommandPalette open onClose={() => undefined} role="parent" />)
  await user.type(input(), 'zebra{Enter}')
  expect(mockPush).toHaveBeenCalledWith('/dashboard/search?q=zebra')
})

it('waits for two letters', async () => {
  const user = userEvent.setup()
  render(<CommandPalette open onClose={() => undefined} role="parent" />)
  await user.type(input(), 'z')
  expect(screen.queryByRole('button', { name: /Search the household/ })).toBeNull()
})

it.each(['teen', 'child'])('never offers search to a %s', async (role) => {
  const user = userEvent.setup()
  render(<CommandPalette open onClose={() => undefined} role={role} />)
  await user.type(input(), 'zebra{Enter}')
  expect(screen.queryByRole('button', { name: /Search the household/ })).toBeNull()
  expect(screen.getByText(/No results for/)).toBeTruthy()
  expect(mockPush).not.toHaveBeenCalled()
})

// O-37: the palette uses the same role filter as the tabs and the redirect.
it('offers a teen Calendar, Meals and Settings, but never Features or Family', async () => {
  render(<CommandPalette open onClose={() => undefined} role="teen" />)
  for (const name of ['Calendar', 'Meals', 'Settings', 'Lists', 'Emergency']) {
    expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeTruthy()
  }
  for (const name of ['Features', 'Family', 'Chores', 'Budget']) {
    expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull()
  }
})

it('offers a child neither Calendar, Meals nor Settings', async () => {
  render(<CommandPalette open onClose={() => undefined} role="child" />)
  expect(screen.getByRole('button', { name: /^Lists/ })).toBeTruthy()
  for (const name of ['Calendar', 'Meals', 'Settings', 'Features']) {
    expect(screen.queryByRole('button', { name: new RegExp(`^${name}`) })).toBeNull()
  }
})

it('searches and presents enabled feature destinations with Spanish display titles', async () => {
  const user = userEvent.setup()
  render(
    <I18nProvider locale="es">
      <CommandPalette open onClose={() => undefined} role="parent" />
    </I18nProvider>,
  )
  await user.type(screen.getByRole('textbox', { name: 'Buscar o ir a una página' }), 'emergencia')
  const result = screen.getByRole('button', { name: 'Contactos de emergencia' })
  expect(result).toBeTruthy()
  expect(result.querySelector('svg')).toBeTruthy()
})
