/**
 * @jest-environment jsdom
 */
// After "List created!" the page waits before redirecting. The Create button
// used to come back during that pause, so a second tap made a second list.
import * as React from 'react'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }))

import CreateListPage from '../page'

let creates: number

beforeEach(() => {
  creates = 0
  push.mockClear()
  global.fetch = jest.fn(async () => {
    creates += 1
    return { ok: true, status: 200, json: async () => ({ list: { id: 'l1' } }) } as Response
  }) as unknown as typeof fetch
})

afterEach(() => {
  jest.useRealTimers()
})

it('keeps Create disabled from success until the redirect', async () => {
  jest.useFakeTimers()
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
  render(<CreateListPage />)

  await user.type(screen.getByLabelText('Name'), 'Weekly Groceries')
  await user.click(screen.getByRole('button', { name: /Create List/ }))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'List created!')

  const button = screen.getByRole('button', { name: 'List created' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  await user.click(button)
  expect(creates).toBe(1)

  await act(async () => {
    jest.advanceTimersByTime(1500)
  })
  expect(push).toHaveBeenCalledWith('/dashboard/lists')
  expect(creates).toBe(1)
})

it('a double tap on Create sends one request', async () => {
  const user = userEvent.setup()
  render(<CreateListPage />)
  await user.type(screen.getByLabelText('Name'), 'Chores')
  await user.dblClick(screen.getByRole('button', { name: /Create List/ }))
  await screen.findByRole('status')
  expect(creates).toBe(1)
})

it('a failed create lets the parent try again', async () => {
  global.fetch = jest.fn(async () => {
    creates += 1
    return { ok: false, status: 500, json: async () => ({ error: 'Server error' }) } as Response
  }) as unknown as typeof fetch
  const user = userEvent.setup()
  render(<CreateListPage />)
  await user.type(screen.getByLabelText('Name'), 'Chores')
  await user.click(screen.getByRole('button', { name: /Create List/ }))
  expect((await screen.findByRole('alert')).textContent).toBe('Server error')
  await user.click(screen.getByRole('button', { name: /Create List/ }))
  await screen.findByRole('alert')
  expect(creates).toBe(2)
})
