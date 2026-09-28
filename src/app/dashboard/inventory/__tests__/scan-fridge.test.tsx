/**
 * @jest-environment jsdom
 */
// "Scan fridge" (#265): button visibility, upload, review/edit, add through
// POST /api/inventory, partial failure without duplicates, and error states.
// fetch is mocked: no provider or server is reached.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom'
import InventoryClient from '../InventoryClient'
import { confidenceLabel } from '../ScanFridgeDialog'

jest.mock('@/components/providers/features-provider', () => ({
  useFeatureEnabled: () => false,
}))

type Call = { url: string; method: string; body: unknown }

const SUGGESTIONS = [
  { name: 'Milk', amount: 2, unit: 'L', location: 'fridge', confidence: 0.95 },
  { name: 'Frozen peas', amount: null, unit: 'bag', location: 'freezer', confidence: 0.6 },
  { name: '<b>Mystery</b> jar', amount: null, unit: null, location: null, confidence: 0.3 },
]

function json(status: number, data: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, headers: { get: () => null } } as unknown as Response
}

function setup({
  canScan = true,
  canWrite = true,
  scan = () => json(200, { items: SUGGESTIONS, dropped: 0 }),
  create = (_body: any, _n: number) => json(201, { item: { id: 'new' } }),
}: {
  canScan?: boolean
  canWrite?: boolean
  scan?: () => Response | Promise<Response>
  create?: (body: any, n: number) => Response
} = {}) {
  const calls: Call[] = []
  let creates = 0
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body
    calls.push({ url, method, body })
    if (url === '/api/inventory/scan') return scan()
    if (url.startsWith('/api/inventory/use-soon')) return json(200, { days: 3, items: [] })
    if (url.startsWith('/api/inventory?') && method === 'GET') return json(200, { items: [], nextOffset: null })
    if (url.startsWith('/api/inventory?') && method === 'POST') return create(body, creates++)
    return json(404, {})
  }) as unknown as typeof fetch
  render(<InventoryClient canWrite={canWrite} canOpenRecipes={false} canScan={canScan} />)
  return { calls, user: userEvent.setup() }
}

async function openAndScan(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Scan fridge' }))
  const dialog = screen.getByRole('dialog', { name: 'Scan the fridge' })
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'fridge.jpg', { type: 'image/jpeg' })
  await user.upload(within(dialog).getByTestId('scan-file-input'), file)
  return dialog
}

describe('Scan fridge', () => {
  it('is hidden when scanning is not available (kill switch, or not a parent)', async () => {
    setup({ canScan: false })
    await screen.findByText('Nothing tracked yet')
    expect(screen.queryByRole('button', { name: 'Scan fridge' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add item' }).length).toBeGreaterThan(0)
  })

  it('opens with a privacy note and a camera-capable file input', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Scan fridge' }))
    const dialog = screen.getByRole('dialog', { name: 'Scan the fridge' })
    expect(within(dialog).getByTestId('scan-privacy-note')).toHaveTextContent('sent to our AI provider (Anthropic)')
    expect(within(dialog).getByTestId('scan-privacy-note')).toHaveTextContent("isn't saved")
    const input = within(dialog).getByTestId('scan-file-input')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).toHaveAttribute('capture', 'environment')
    expect(within(dialog).getByRole('button', { name: 'Take or choose a photo' })).toBeInTheDocument()
  })

  it('uploads the photo as multipart and lists editable suggestions with confidence in words', async () => {
    const { user, calls } = setup()
    const dialog = await openAndScan(user)
    const scanCall = calls.find((c) => c.url === '/api/inventory/scan')!
    expect(scanCall.method).toBe('POST')
    expect(scanCall.body).toBeInstanceOf(FormData)
    expect((scanCall.body as FormData).get('image')).toBeTruthy()

    const rows = await within(dialog).findAllByTestId('scan-suggestion')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]).getByTestId('scan-confidence')).toHaveTextContent('Likely')
    expect(within(rows[1]).getByTestId('scan-confidence')).toHaveTextContent('Check this')
    expect(within(rows[2]).getByTestId('scan-confidence')).toHaveTextContent('Unsure')
    // Low-confidence suggestions start unticked.
    expect(within(rows[0]).getByRole('checkbox')).toBeChecked()
    expect(within(rows[2]).getByRole('checkbox')).not.toBeChecked()
    // Model text is a value, never markup.
    expect(within(rows[2]).getByLabelText('Name')).toHaveValue('<b>Mystery</b> jar')
    expect(dialog.querySelector('b')).toBeNull()
    // Unknown location defaults to the fridge.
    expect(within(rows[2]).getByLabelText('Where')).toHaveValue('fridge')
    expect(within(dialog).getByRole('button', { name: 'Add 2 items' })).toBeEnabled()
  })

  it('adds only the ticked, edited items through POST /api/inventory and reports the count', async () => {
    const { user, calls } = setup()
    const dialog = await openAndScan(user)
    const rows = await within(dialog).findAllByTestId('scan-suggestion')

    const name = within(rows[0]).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Oat milk')
    await user.selectOptions(within(rows[1]).getByLabelText('Where'), 'pantry')
    const date = within(rows[1]).getByLabelText('Use by')
    await user.type(date, '2030-01-15')
    await user.click(within(rows[2]).getByRole('checkbox'))
    await user.click(within(rows[1]).getByRole('checkbox'))
    await user.click(within(rows[1]).getByRole('checkbox'))

    await user.click(within(dialog).getByRole('button', { name: 'Add 3 items' }))
    await screen.findByText('Added 3 items from your photo.')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const posts = calls.filter((c) => c.url.startsWith('/api/inventory?today=') && c.method === 'POST')
    expect(posts.map((p) => p.body)).toEqual([
      { name: 'Oat milk', location: 'fridge', amount: 2, unit: 'L', expires_on: null },
      { name: 'Frozen peas', location: 'pantry', amount: null, unit: 'bag', expires_on: '2030-01-15' },
      { name: '<b>Mystery</b> jar', location: 'fridge', amount: null, unit: null, expires_on: null },
    ])
  })

  it('keeps failed rows after a partial failure and retries only those (no duplicates)', async () => {
    const { user, calls } = setup({
      create: (body, n) =>
        n === 1 ? json(400, { error: { code: 'VALIDATION_ERROR', message: 'Name is too long', retryable: false } }) : json(201, { item: {} }),
    })
    const dialog = await openAndScan(user)
    await within(dialog).findAllByTestId('scan-suggestion')
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Added 1 item. 1 couldn't be added")
    const left = within(dialog).getAllByTestId('scan-suggestion')
    expect(left).toHaveLength(2) // the failed one and the unticked one
    expect(within(left[0]).getByTestId('scan-row-error')).toHaveTextContent('Name is too long')

    await user.click(within(dialog).getByRole('button', { name: 'Add 1 item' }))
    await screen.findByText('Added 2 items from your photo.')
    const posted = calls.filter((c) => c.url.startsWith('/api/inventory?today=') && c.method === 'POST').map((c) => (c.body as any).name)
    expect(posted).toEqual(['Milk', 'Frozen peas', 'Frozen peas'])
  })

  it('validates edited amounts before sending anything', async () => {
    const { user, calls } = setup()
    const dialog = await openAndScan(user)
    const rows = await within(dialog).findAllByTestId('scan-suggestion')
    const name = within(rows[0]).getByLabelText('Name')
    await user.clear(name)
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 items' }))
    expect(within(rows[0]).getByTestId('scan-row-error')).toHaveTextContent('Enter a name.')
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Fix the highlighted items')
    expect(calls.some((c) => c.url.startsWith('/api/inventory?today=') && c.method === 'POST')).toBe(false)
  })

  it.each([
    [429, { error: { code: 'SCAN_DAILY_LIMIT', message: "Your household has used today's fridge scans." } }, "used today's fridge scans"],
    [404, { error: { code: 'INVENTORY_SCAN_DISABLED', message: 'x' } }, "Fridge scan isn't available right now"],
    [502, { error: { code: 'SCAN_PROVIDER_UNAVAILABLE', message: 'The photo scanner is not responding right now.' } }, 'not responding'],
    [415, { error: { code: 'UNSUPPORTED_IMAGE_TYPE', message: 'Use a JPEG, PNG or WebP photo.' } }, 'Use a JPEG, PNG or WebP photo.'],
    [500, { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 'Something went wrong while scanning'],
  ])('shows a readable error for a %s and offers another photo', async (status, body, text) => {
    const { user } = setup({ scan: () => json(status, body) })
    const dialog = await openAndScan(user)
    expect(await within(dialog).findByTestId('scan-error')).toHaveTextContent(text)
    expect(within(dialog).getByRole('button', { name: 'Try another photo' })).toBeInTheDocument()
  })

  it('handles a network failure and closes', async () => {
    const first = setup({
      scan: () => {
        throw new Error('offline')
      },
    })
    const dialog = await openAndScan(first.user)
    expect(await within(dialog).findByTestId('scan-error')).toHaveTextContent("Couldn't reach the scanner")
    await first.user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('says so when no food is found', async () => {
    const { user } = setup({ scan: () => json(200, { items: [], dropped: 0 }) })
    const dialog = await openAndScan(user)
    expect(await within(dialog).findByText('No food found in that photo.')).toBeInTheDocument()
  })

  it('maps confidence to words', () => {
    expect(confidenceLabel(0.8)).toBe('Likely')
    expect(confidenceLabel(0.5)).toBe('Check this')
    expect(confidenceLabel(0.49)).toBe('Unsure')
  })
})
