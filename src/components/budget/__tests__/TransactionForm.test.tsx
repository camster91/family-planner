/**
 * @jest-environment jsdom
 */
// Two fixes: switching Expense/Income used to keep the chosen category (so an
// income could be saved under an expense category), and the Dialog moved focus
// to Close after mount, overriding Amount's autofocus on a new transaction.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TransactionForm from '../TransactionForm'

const CATEGORIES = [
  { id: 'cat_food', name: 'Food', icon: 'F', color: '#f00', type: 'expense', budget_limit: null },
  { id: 'cat_rent', name: 'Rent', icon: 'R', color: '#0f0', type: 'expense', budget_limit: null },
  { id: 'cat_pay', name: 'Pay', icon: 'P', color: '#00f', type: 'income', budget_limit: null },
]

type Call = { url: string; method: string; body: Record<string, unknown> | undefined }
let calls: Call[]

beforeEach(() => {
  calls = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) {
      const type = new URL(url, 'http://x').searchParams.get('type')
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === type) }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch
})

const noop = () => {}

it('focuses Amount when adding a transaction', async () => {
  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Amount')))
})

it('keeps the Dialog default focus when editing', async () => {
  render(
    <TransactionForm
      onClose={noop}
      onSuccess={noop}
      initialData={{ id: 't1', amount: 12, type: 'expense', category_id: 'cat_food', date: '2026-09-30T00:00:00.000Z' }}
    />
  )
  await screen.findByRole('option', { name: /Food/ })
  expect(document.activeElement).not.toBe(screen.getByLabelText('Amount'))
})

it('clears the category when the type changes, so it is not saved under the wrong type', async () => {
  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  await screen.findByRole('option', { name: /Food/ })
  await user.selectOptions(screen.getByLabelText('Category'), 'cat_food')
  expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat_food')

  // Tapping the type that is already on keeps the choice.
  await user.click(screen.getByRole('button', { name: /Expense/ }))
  expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('cat_food')

  await user.click(screen.getByRole('button', { name: /Income/ }))
  await screen.findByRole('option', { name: /Pay/ })
  expect((screen.getByLabelText('Category') as HTMLSelectElement).value).toBe('')

  await user.type(screen.getByLabelText('Amount'), '50')
  await user.click(screen.getByRole('button', { name: /^(Add|Save)/ }))
  await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
  expect(calls.find((c) => c.method === 'POST')!.body).toEqual(
    expect.objectContaining({ type: 'income', category_id: null, amount: 50 })
  )
})
