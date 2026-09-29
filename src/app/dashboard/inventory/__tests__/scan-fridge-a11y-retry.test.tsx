/**
 * @jest-environment jsdom
 */
// Scan fridge dialog (#265, review follow-ups): idempotent retries (one row
// per suggestion even when a create lands but its response is lost), focus
// management (moved in, follows each step, Tab trapped, restored to the Scan
// button) and Escape going through the same close path as the Close button.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import InventoryClient from '../InventoryClient'
import { ToastProvider } from '@/components/ui/toast'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => false,
}))

// jsdom has no layout, so offsetParent is always null and the shared Dialog's
// Tab trap would see no visible elements. Treat attached elements as visible.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      return this.isConnected ? document.body : null
    },
  })
})

const SUGGESTIONS = [
  { name: 'Milk', amount: 2, unit: 'L', location: 'fridge', confidence: 0.95 },
  { name: 'Eggs', amount: 6, unit: null, location: 'fridge', confidence: 0.9 },
]

function json(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: () => null } } as unknown as Response
}

type Post = { key: string | null; body: any }

/**
 * A fake server that honours Idempotency-Key like the real route: the same
 * key and body replays the stored item, the same key with another body is 422.
 * `plan(n)` decides what happens to the n-th create attempt:
 * 'ok', 'lost' (committed, then the response is lost) or 'fail' (400, nothing stored).
 */
function setup(plan: (n: number) => 'ok' | 'lost' | 'fail' = () => 'ok', scan = () => json(200, { items: SUGGESTIONS, dropped: 0 })) {
  const posts: Post[] = []
  const stored = new Map<string, { body: string; item: { id: string; name: string } }>()
  const created: string[] = []
  let gets = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/inventory/scan') return scan()
    if (url.startsWith('/api/inventory/use-soon')) return json(200, { days: 3, items: [] })
    if (url.startsWith('/api/inventory?') && method === 'GET') {
      gets++
      return json(200, { items: [], nextOffset: null })
    }
    if (url.startsWith('/api/inventory?') && method === 'POST') {
      const headers = (init?.headers ?? {}) as Record<string, string>
      const key = headers['Idempotency-Key'] ?? null
      const body = String(init?.body)
      const n = posts.length
      posts.push({ key, body: JSON.parse(body) })
      if (key && stored.has(key)) {
        const prior = stored.get(key)!
        if (prior.body !== body) {
          return json(422, { error: { code: 'IDEMPOTENCY_KEY_REUSED', message: 'reused', retryable: false } })
        }
        return json(201, { item: prior.item })
      }
      const outcome = plan(n)
      if (outcome === 'fail') return json(400, { error: { code: 'VALIDATION_ERROR', message: 'Nope', retryable: false } })
      const item = { id: `item-${created.length}`, name: JSON.parse(body).name }
      created.push(item.name)
      if (key) stored.set(key, { body, item })
      if (outcome === 'lost') throw new TypeError('Failed to fetch')
      return json(201, { item })
    }
    return json(404, {})
  }) as unknown as typeof fetch
  render(
    <ToastProvider>
      <InventoryClient canWrite canOpenRecipes={false} canScan />
    </ToastProvider>
  )
  return { posts, created, gets: () => gets, user: userEvent.setup() }
}

async function openAndScan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Scan fridge' }))
  const dialog = screen.getByRole('dialog', { name: 'Scan the fridge' })
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'fridge.jpg', { type: 'image/jpeg' })
  await user.upload(within(dialog).getByTestId('scan-file-input'), file)
  await within(dialog).findAllByTestId('scan-suggestion')
  return dialog
}

describe('Scan fridge: idempotent retries', () => {
  it('sends one stable Idempotency-Key per row, distinct between rows', async () => {
    const { user, posts } = setup()
    const dialog = await openAndScan(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))
    await screen.findByText('Added 2 items from your photo.')
    expect(posts).toHaveLength(2)
    expect(posts.every((p) => typeof p.key === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(p.key!))).toBe(true)
    expect(posts[0].key).not.toBe(posts[1].key)
  })

  it('a create that landed but lost its response is replayed on retry: one inventory row, not two', async () => {
    // Attempt 0 (Milk): committed, response lost. Attempt 1 (Eggs): ok.
    const { user, posts, created } = setup((n) => (n === 0 ? 'lost' : 'ok'))
    const dialog = await openAndScan(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Added 1 item. 1 couldn't be added")
    const left = within(dialog).getAllByTestId('scan-suggestion')
    expect(left).toHaveLength(1)
    expect(within(left[0]).getByLabelText('Name')).toHaveValue('Milk')

    await user.click(within(dialog).getByRole('button', { name: 'Add 1 item' }))
    await screen.findByText('Added 2 items from your photo.')

    const milkPosts = posts.filter((p) => p.body.name === 'Milk')
    expect(milkPosts).toHaveLength(2)
    expect(milkPosts[0].key).toBe(milkPosts[1].key)
    expect(created).toEqual(['Milk', 'Eggs'])
  })

  it('an in-doubt row edited before retry is unticked with a warning instead of being added twice', async () => {
    const { user, posts, created } = setup((n) => (n === 0 ? 'lost' : 'ok'))
    const dialog = await openAndScan(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))
    await within(dialog).findByRole('alert')

    const row = within(dialog).getAllByTestId('scan-suggestion')[0]
    const name = within(row).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Whole milk')
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 item' }))

    expect(await within(row).findByTestId('scan-row-error')).toHaveTextContent('probably added on an earlier try')
    expect(within(row).getByRole('checkbox')).not.toBeChecked()
    expect(created).toEqual(['Milk', 'Eggs'])

    // Adding it again is now a deliberate choice with a fresh key.
    await user.click(within(row).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: 'Add 1 item' }))
    await screen.findByText('Added 2 items from your photo.')
    expect(created).toEqual(['Milk', 'Eggs', 'Whole milk'])
    const keys = posts.filter((p) => p.body.name !== 'Eggs').map((p) => p.key)
    expect(keys[0]).toBe(keys[1])
    expect(keys[2]).not.toBe(keys[0])
  })
})

describe('Scan fridge: focus and Escape', () => {
  it('moves focus in, follows each step, and keeps Tab inside the dialog', async () => {
    const { user } = setup()
    const scanButton = await screen.findByRole('button', { name: 'Scan fridge' })
    await user.click(scanButton)
    const dialog = screen.getByRole('dialog', { name: 'Scan the fridge' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: 'Take or choose a photo' })).toHaveFocus()

    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'f.jpg', { type: 'image/jpeg' })
    await user.upload(within(dialog).getByTestId('scan-file-input'), file)
    await waitFor(() => expect(within(dialog).getByTestId('scan-found')).toHaveFocus())

    // Tab through every control and wrap: focus never leaves the dialog.
    for (let i = 0; i < 25; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
    // Shift+Tab from the first control wraps to the last.
    within(dialog).getByRole('button', { name: 'Close' }).focus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Add 2 items' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
  })

  it('moves focus to "Try another photo" after a scan error', async () => {
    const { user } = setup(undefined, () => json(502, { error: { code: 'SCAN_PROVIDER_UNAVAILABLE', message: 'Down.' } }))
    await user.click(await screen.findByRole('button', { name: 'Scan fridge' }))
    const dialog = screen.getByRole('dialog', { name: 'Scan the fridge' })
    await user.upload(within(dialog).getByTestId('scan-file-input'), new File([new Uint8Array([1])], 'f.jpg', { type: 'image/jpeg' }))
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Try another photo' })).toHaveFocus())
  })

  it('restores focus to the Scan fridge button when closed', async () => {
    const { user } = setup()
    const scanButton = await screen.findByRole('button', { name: 'Scan fridge' })
    await user.click(scanButton)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(scanButton).toHaveFocus()

    await user.click(scanButton)
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(scanButton).toHaveFocus()
  })

  it('Escape after a partial add reports the added items and reloads the list, like Close', async () => {
    const { user, gets } = setup((n) => (n === 1 ? 'fail' : 'ok'))
    const dialog = await openAndScan(user)
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))
    await within(dialog).findByRole('alert')
    const before = gets()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Added 1 item from your photo.')).toBeInTheDocument()
    await waitFor(() => expect(gets()).toBeGreaterThan(before))
  })

  it('Escape without anything added just closes (no notice)', async () => {
    const { user } = setup()
    await openAndScan(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText(/from your photo/)).not.toBeInTheDocument()
  })
})
