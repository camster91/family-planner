/**
 * @jest-environment jsdom
 */
// Two fixes: switching Expense/Income used to keep the chosen category (so an
// income could be saved under an expense category), and the Dialog moved focus
// to Close after mount, overriding Amount's autofocus on a new transaction.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nProvider } from '@/i18n'
import { toDateOnlyLocal } from '@/lib/dates'
import TransactionForm from '../TransactionForm'

const CATEGORIES = [
  { id: 'cat_food', name: 'Food', icon: 'F', color: '#f00', type: 'expense', budget_limit: null },
  { id: 'cat_rent', name: 'Rent', icon: 'R', color: '#0f0', type: 'expense', budget_limit: null },
  { id: 'cat_pay', name: 'Pay', icon: 'P', color: '#00f', type: 'income', budget_limit: null },
]

type Call = { url: string; method: string; body: Record<string, unknown> | undefined; headers?: HeadersInit }
let calls: Call[]

const SAVED_TRANSACTION = {
  id: 'tx-created',
  amount: 50,
  type: 'expense',
  description: null,
  notes: null,
  category_id: null,
  date: toDateOnlyLocal(new Date()),
  is_recurring: false,
  recurring_interval: null,
  category: null,
  user: { id: 'u1', name: 'Cameron', avatar_url: null },
}

beforeEach(() => {
  calls = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers })
    if (url.startsWith('/api/budget/categories')) {
      const type = new URL(url, 'http://x').searchParams.get('type')
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === type) }) } as Response
    }
    if (method === 'DELETE') return { ok: true, status: 200, json: async () => ({ success: true }) } as Response
    const body = init?.body ? JSON.parse(String(init.body)) : {}
    return { ok: true, status: 200, json: async () => ({ transaction: { ...SAVED_TRANSACTION, ...body } }) } as Response
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

it('shows a category recovery state instead of a false empty result', async () => {
  let attempts = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) {
      attempts += 1
      if (attempts === 1) return { ok: false, status: 503 } as Response
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={noop} />)

  expect((await screen.findByRole('alert')).textContent).toContain('Categories could not be refreshed')
  expect(screen.queryByText(/No expense categories yet/)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Retry categories' }))
  await screen.findByRole('option', { name: /Food/ })
})

it('keeps category recovery truthful for a network failure', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) throw new Error('offline')
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  expect((await screen.findByRole('alert')).textContent).toContain('Check your connection')
  expect(screen.queryByText(/No expense categories yet/)).toBeNull()
})

it('treats an invalid categories body as a server failure instead of false empty state', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({}) } as Response
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response
  }) as unknown as typeof fetch

  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  expect((await screen.findByRole('alert')).textContent).toContain('Categories could not be refreshed')
  expect(screen.queryByText(/No expense categories yet/)).toBeNull()
})

it('uses localized recovery copy for object error envelopes without rendering private payloads', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    return {
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'IDENTITY_CONFLICT', message: 'private implementation detail' } }),
    } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(
    <I18nProvider locale="es">
      <TransactionForm onClose={noop} onSuccess={noop} />
    </I18nProvider>
  )
  await screen.findByRole('option', { name: /Food/ })
  await user.type(screen.getByLabelText('Importe'), '50')
  await user.click(screen.getByRole('button', { name: 'Añadir transacción' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('No pudimos confirmar que se guardó la transacción')
  expect(alert.textContent).not.toContain('private implementation detail')
  expect(alert.textContent).not.toContain('IDENTITY_CONFLICT')
})

it('uses safe recovery copy for object delete errors too', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    return {
      ok: false,
      status: 403,
      json: async () => ({ error: { code: 'PARENT_REQUIRED', message: { private: true } } }),
    } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(
    <TransactionForm
      onClose={noop}
      onSuccess={noop}
      initialData={{ id: 't1', amount: 12, type: 'expense', category_id: 'cat_food', date: '2026-09-30T00:00:00.000Z' }}
    />
  )
  await screen.findByRole('option', { name: /Food/ })
  await user.click(screen.getByRole('button', { name: 'Delete transaction' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain("Couldn't delete the transaction")
  expect(alert.textContent).not.toContain('private')
})

it('reuses an idempotency key for an ambiguous save retry while keeping the draft', async () => {
  let saveAttempts = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    saveAttempts += 1
    if (saveAttempts === 1) return { ok: false, status: 503, json: async () => ({ error: 'temporary' }) } as Response
    const body = JSON.parse(String(init?.body))
    return { ok: true, status: 201, json: async () => ({ transaction: { ...SAVED_TRANSACTION, ...body } }) } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  await screen.findByRole('option', { name: /Food/ })
  await user.type(screen.getByLabelText('Amount'), '50')
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))

  expect((await screen.findByRole('alert')).textContent).toContain("couldn't confirm")
  expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('50')
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2))
  const firstKey = (calls[1].headers as Record<string, string>)['Idempotency-Key']
  const secondKey = (calls[2].headers as Record<string, string>)['Idempotency-Key']
  expect(firstKey).toMatch(/^[0-9a-f-]{36}$/)
  expect(secondKey).toBe(firstKey)
})

it('retains the save intent when a success response is malformed', async () => {
  const onSuccess = jest.fn()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    return { ok: true, status: 201, json: async () => ({ transaction: { id: 'created', amount: 50 } }) } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={onSuccess} />)
  await screen.findByRole('option', { name: /Food/ })
  await user.type(screen.getByLabelText('Amount'), '50')
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))
  expect((await screen.findByRole('alert')).textContent).toContain("couldn't confirm")
  expect(onSuccess).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
})

it('rejects a success row whose category identity does not match category_id', async () => {
  const onSuccess = jest.fn()
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    const body = JSON.parse(String(init?.body))
    return {
      ok: true,
      status: 201,
      json: async () => ({ transaction: {
        ...SAVED_TRANSACTION,
        ...body,
        category_id: 'cat_food',
        category: { id: 'cat_rent', name: 'Rent', icon: 'R', color: '#0f0' },
      } }),
    } as Response
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={onSuccess} />)
  await screen.findByRole('option', { name: /Food/ })
  await user.selectOptions(screen.getByLabelText('Category'), 'cat_food')
  await user.type(screen.getByLabelText('Amount'), '50')
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))

  expect((await screen.findByRole('alert')).textContent).toContain("couldn't confirm")
  expect(onSuccess).not.toHaveBeenCalled()
})

it('does not let a slower old category request win after switching type', async () => {
  const resolvers: Array<(value: Response) => void> = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Promise<Response>((resolve) => {
      resolvers.push(resolve)
    })
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  await user.click(screen.getByRole('button', { name: /Income/ }))
  await waitFor(() => expect(resolvers).toHaveLength(2))

  resolvers[0]({ ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response)
  expect(screen.queryByRole('option', { name: /Food/ })).toBeNull()
  resolvers[1]({ ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'income') }) } as Response)
  expect(await screen.findByRole('option', { name: /Pay/ })).toBeTruthy()
})

it('blocks dismissal while a transaction save is pending and preserves the draft', async () => {
  let resolveSave: (value: Response) => void = () => {}
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url.startsWith('/api/budget/categories')) {
      return { ok: true, status: 200, json: async () => ({ categories: CATEGORIES.filter((c) => c.type === 'expense') }) } as Response
    }
    return new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
  }) as unknown as typeof fetch

  const user = userEvent.setup()
  render(<TransactionForm onClose={noop} onSuccess={noop} />)
  await screen.findByRole('option', { name: /Food/ })
  await user.type(screen.getByLabelText('Amount'), '50')
  await user.click(screen.getByRole('button', { name: 'Add transaction' }))

  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  await user.keyboard('{Escape}')
  expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('50')

  resolveSave({ ok: true, status: 200, json: async () => ({ transaction: { ...SAVED_TRANSACTION, amount: 50 } }) } as Response)
  await waitFor(() => expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false))
})
