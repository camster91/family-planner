/**
 * @jest-environment jsdom
 */
// Command palette → household search (route inventory F-3): a parent can hand
// the typed words to /dashboard/search; a teen or child, who cannot open that
// page, is never offered it.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { defaultFeatures } from '@/lib/features'
import CommandPalette from '../CommandPalette'

const mockPush = jest.fn()
jest.mock('@/components/providers/features-provider', () => ({
  useFeatures: () => ({ features: defaultFeatures() }),
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
}))

beforeEach(() => mockPush.mockReset())

const input = () => screen.getByRole('textbox', { name: 'Search or go to a page' })

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
