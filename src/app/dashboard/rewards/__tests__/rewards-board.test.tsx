/**
 * @jest-environment jsdom
 */
// The rewards page used to render a "Claim Reward" button with no handler, and
// nothing called /api/rewards/approve, so a claimed reward stayed "Claimed"
// for ever. Claiming now asks first and calls the claim API; a parent marks a
// claimed reward as given through the approve API. Failures say why.
import * as React from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import RewardsBoard, { type RewardCard } from '../RewardsBoard'

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}))

const MOVIE: RewardCard = {
  id: 'r_movie',
  name: 'Movie night',
  description: 'Pick the film',
  icon: '🎬',
  cost: 50,
  status: 'available',
  claimedById: null,
  claimedByName: null,
}
const ICE_CREAM: RewardCard = {
  id: 'r_ice',
  name: 'Ice cream',
  description: null,
  icon: null,
  cost: 20,
  status: 'claimed',
  claimedById: 'kid_1',
  claimedByName: 'Sam',
}

type Call = { url: string; method: string; body: any }

function mockFetch(answer: (url: string) => { status: number; body: unknown } | 'throw') {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const a = answer(url)
    if (a === 'throw') throw new TypeError('Failed to fetch')
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body } as Response
  }) as unknown as typeof fetch
  return calls
}

function renderBoard(props: Partial<React.ComponentProps<typeof RewardsBoard>> = {}) {
  return render(
    <ToastProvider>
      <RewardsBoard rewards={[MOVIE, ICE_CREAM]} userXp={80} isParent={false} currentUserId="kid_1" {...props} />
    </ToastProvider>
  )
}

beforeEach(() => refresh.mockReset())

describe('RewardsBoard', () => {
  it('lets a parent add another reward once some exist; a child sees no add button', () => {
    const { unmount } = renderBoard({ isParent: true })
    expect(screen.getByRole('link', { name: 'Add reward' }).getAttribute('href')).toBe('/dashboard/rewards/create')
    unmount()
    renderBoard({ isParent: false })
    expect(screen.queryByRole('link', { name: 'Add reward' })).toBeNull()
  })

  it('shows a gift instead of a stored word icon', () => {
    renderBoard({ rewards: [{ ...MOVIE, icon: 'tv' }] })
    expect(screen.queryByText('tv')).toBeNull()
    expect(screen.getAllByText('🎁').length).toBeGreaterThan(0)
  })

  it('claims a reward after confirming, then refreshes the page', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(() => ({ status: 200, body: { reward: {}, xp: 30 } }))
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    const dialog = screen.getByRole('dialog', { name: 'Claim Movie night?' })
    expect(dialog.textContent).toContain('This uses 50 points')
    expect(calls).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Claim' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls).toEqual([{ url: '/api/rewards/claim', method: 'POST', body: { rewardId: 'r_movie' } }])
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Claimed Movie night')).toBeTruthy()
  })

  it("keeps the dialog open and shows the server's reason when a claim is refused", async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 409, body: { error: 'Reward is no longer available' } }))
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Reward is no longer available')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('says to check the connection when a claim cannot reach the server', async () => {
    const user = userEvent.setup()
    mockFetch(() => 'throw')
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Check your connection and try again.')
  })

  it('cannot claim without enough points', () => {
    mockFetch(() => ({ status: 200, body: {} }))
    renderBoard({ userXp: 10 })
    const button = screen.getByRole('button', { name: 'Need 40 more points' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('shows a child their claim is waiting for a parent, with no approve button', () => {
    mockFetch(() => ({ status: 200, body: {} }))
    renderBoard()
    const row = screen.getAllByTestId('family-reward').find((r) => r.textContent?.includes('Ice cream'))!
    expect(row.textContent).toContain('Claimed by you')
    expect(row.textContent).toContain('Waiting for a parent')
    expect(within(row).queryByRole('button')).toBeNull()
  })

  it('lets a parent mark a claimed reward as given', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(() => ({ status: 200, body: { reward: {} } }))
    renderBoard({ isParent: true, currentUserId: 'parent_1' })
    const row = screen.getAllByTestId('family-reward').find((r) => r.textContent?.includes('Ice cream'))!
    expect(row.textContent).toContain('Claimed by Sam')
    await user.click(within(row).getByRole('button', { name: 'Mark Ice cream as given' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls).toEqual([{ url: '/api/rewards/approve', method: 'POST', body: { rewardId: 'r_ice' } }])
    expect(screen.getByText('Ice cream marked as given')).toBeTruthy()
  })

  it('shows an error toast with the reason when marking as given fails', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 400, body: { error: 'Reward must be claimed before approval' } }))
    renderBoard({ isParent: true, currentUserId: 'parent_1' })
    await user.click(screen.getByRole('button', { name: 'Mark Ice cream as given' }))
    expect(await screen.findByText('Reward must be claimed before approval')).toBeTruthy()
    expect(screen.getByText("Couldn't mark Ice cream as given")).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('labels a given reward in text', () => {
    mockFetch(() => ({ status: 200, body: {} }))
    renderBoard({ rewards: [{ ...ICE_CREAM, status: 'redeemed' }], isParent: true })
    const row = screen.getByTestId('family-reward')
    expect(row.textContent).toContain('Given')
    expect(within(row).queryByRole('button')).toBeNull()
  })
})
