/**
 * @jest-environment jsdom
 */
// Settings → Delete account / household (D-3, docs/product/ACCOUNT_DELETION.md):
// the in-page confirmation, export first, fresh password, typed confirmation,
// the right endpoint per role, errors, and the network-retry rule.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import DeleteAccountDialog from '../DeleteAccountDialog'
import type { DeletionOptions } from '@/lib/account-deletion-shared'

type Call = { url: string; method: string; body: any; headers: Record<string, string> }

const MEMBER: DeletionOptions = {
  role: 'teen',
  household: { id: 'fam-1', name: 'The Rivers', memberCount: 4, parentCount: 1 },
  isOnlyParent: false,
  canDeleteAccount: true,
  canDeleteHousehold: false,
}
const ONLY_PARENT: DeletionOptions = {
  ...MEMBER,
  role: 'parent',
  isOnlyParent: true,
  canDeleteAccount: false,
  canDeleteHousehold: true,
}

function json(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, blob: async () => new Blob(['{}']) } as Response
}

function mockApi(options: DeletionOptions | null, deleteResponses: Array<Response | Error>) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    if (url === '/api/users/deletion') return options ? json(200, options) : json(500, { error: 'x' })
    if (url === '/api/users/export') return json(200, {})
    if (method === 'DELETE') {
      const next = deleteResponses.shift() ?? json(500, {})
      if (next instanceof Error) throw next
      return next
    }
    return json(404, {})
  }) as unknown as typeof fetch
  return calls
}

beforeEach(() => {
  window.confirm = jest.fn(() => true)
})

afterEach(() => {
  // The dialog must never fall back to a browser confirm.
  expect(window.confirm).not.toHaveBeenCalled()
})

describe('DeleteAccountDialog', () => {
  it('a member deletes their own account: password and DELETE required, one request with an Idempotency-Key', async () => {
    const calls = mockApi(MEMBER, [json(200, { success: true, mode: 'account' })])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)

    expect(await screen.findByRole('dialog', { name: 'Delete account' })).toBeTruthy()
    expect(await screen.findByText(/stay with it/)).toBeTruthy()
    const submit = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)

    await userEvent.type(screen.getByLabelText('Your password'), 'secret-pw')
    expect(submit.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/to confirm/), 'delet')
    expect(submit.disabled).toBe(true)
    await userEvent.type(screen.getByLabelText(/to confirm/), 'e')
    expect(submit.disabled).toBe(false)

    await userEvent.click(submit)
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('account'))
    const del = calls.filter((c) => c.method === 'DELETE')
    expect(del).toHaveLength(1)
    expect(del[0].url).toBe('/api/users')
    expect(del[0].body).toEqual({ password: 'secret-pw', confirmation: 'delete' })
    expect(del[0].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('the only parent is offered an invite first, and deletes the household by typing its name', async () => {
    const calls = mockApi(ONLY_PARENT, [json(200, { success: true, mode: 'household' })])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)

    expect(await screen.findByRole('dialog', { name: 'Delete household' })).toBeTruthy()
    expect(await screen.findByText(/all 4 accounts in it/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'invite another parent' }).getAttribute('href')).toBe('/dashboard/family/invite')

    await userEvent.type(screen.getByLabelText('Your password'), 'secret-pw')
    await userEvent.type(screen.getByLabelText(/Type the household name/), 'DELETE')
    const submit = screen.getByRole('button', { name: 'Delete household' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.clear(screen.getByLabelText(/Type the household name/))
    await userEvent.type(screen.getByLabelText(/Type the household name/), 'the rivers')
    expect(submit.disabled).toBe(false)

    await userEvent.click(submit)
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('household'))
    const del = calls.find((c) => c.method === 'DELETE')!
    expect(del.url).toBe('/api/family')
    expect(del.body).toEqual({ familyId: 'fam-1', password: 'secret-pw', confirmation: 'the rivers' })
  })

  it('offers the data export before deleting', async () => {
    const calls = mockApi(MEMBER, [])
    const createObjectURL = jest.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL, revokeObjectURL: jest.fn() })
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={jest.fn()} />)

    await userEvent.click(await screen.findByRole('button', { name: 'Download my data' }))
    expect(await screen.findByText('Your download has started.')).toBeTruthy()
    expect(calls.some((c) => c.url === '/api/users/export')).toBe(true)
    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    click.mockRestore()
  })

  it('shows the server error (wrong password) and lets the member try again', async () => {
    mockApi(MEMBER, [json(400, { error: 'That password is not right.', code: 'INVALID_PASSWORD' })])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)
    await userEvent.type(await screen.findByLabelText('Your password'), 'bad')
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect((await screen.findByRole('alert')).textContent).toBe('That password is not right.')
    expect(onDeleted).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a refusal from the server (another parent joined) is shown as is', async () => {
    mockApi(ONLY_PARENT, [json(409, { error: 'Another parent is still in this household.', code: 'OTHER_PARENTS_EXIST' })])
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={jest.fn()} />)
    await userEvent.type(await screen.findByLabelText('Your password'), 'pw')
    await userEvent.type(screen.getByLabelText(/Type the household name/), 'The Rivers')
    await userEvent.click(screen.getByRole('button', { name: 'Delete household' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Another parent')
  })

  it('a dropped connection is retried once with the same key; a 401 then means it was already deleted', async () => {
    const calls = mockApi(MEMBER, [new TypeError('Failed to fetch'), json(401, { error: 'Unauthorized' })])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)
    await userEvent.type(await screen.findByLabelText('Your password'), 'pw')
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('account'))
    const keys = calls.filter((c) => c.method === 'DELETE').map((c) => c.headers['Idempotency-Key'])
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  it.each([
    ['the network dropped twice', [new TypeError('Failed to fetch'), new TypeError('Failed to fetch')]],
    [
      'the server said the first request was still running',
      [json(409, { error: { code: 'IDEMPOTENCY_IN_PROGRESS', message: 'running', retryable: true } })],
    ],
  ] as const)('after %s, the next click reuses the key and treats a 401 as already deleted', async (_label, first) => {
    const calls = mockApi(MEMBER, [...first, json(401, { error: 'Unauthorized' })])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)
    await userEvent.type(await screen.findByLabelText('Your password'), 'pw')
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onDeleted).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('account'))
    const keys = calls.filter((c) => c.method === 'DELETE').map((c) => c.headers['Idempotency-Key'])
    expect(new Set(keys).size).toBe(1)
  })

  it('after a refused request, a later 401 is an error again (new key)', async () => {
    const calls = mockApi(MEMBER, [
      json(400, { error: 'That password is not right.', code: 'INVALID_PASSWORD' }),
      json(401, { error: 'Unauthorized' }),
    ])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)
    await userEvent.type(await screen.findByLabelText('Your password'), 'pw')
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('password')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('session has ended'))
    expect(onDeleted).not.toHaveBeenCalled()
    const keys = calls.filter((c) => c.method === 'DELETE').map((c) => c.headers['Idempotency-Key'])
    expect(keys[0]).not.toBe(keys[1])
  })

  it('a first-attempt 401 is not treated as success', async () => {
    mockApi(MEMBER, [json(401, { error: 'Unauthorized' })])
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={onDeleted} />)
    await userEvent.type(await screen.findByLabelText('Your password'), 'pw')
    await userEvent.type(screen.getByLabelText(/to confirm/), 'DELETE')
    await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
    expect((await screen.findByRole('alert')).textContent).toContain('session has ended')
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('a load failure offers Try again', async () => {
    const calls = mockApi(null, [])
    render(<DeleteAccountDialog open onClose={() => undefined} onDeleted={jest.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls.filter((c) => c.url === '/api/users/deletion')).toHaveLength(2))
  })

  it('Cancel and Escape close it without a request', async () => {
    const calls = mockApi(MEMBER, [])
    const onClose = jest.fn()
    render(<DeleteAccountDialog open onClose={onClose} onDeleted={jest.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)
  })
})
