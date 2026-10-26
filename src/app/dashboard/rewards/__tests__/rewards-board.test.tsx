/**
 * @jest-environment jsdom
 */
// The rewards page used to render a "Claim Reward" button with no handler, and
// nothing called /api/rewards/approve, so a claimed reward stayed "Claimed"
// for ever. Claiming now asks first and calls the claim API; a parent marks a
// claimed reward as given through the approve API. Failures say why.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '@/components/ui/toast'
import { I18nProvider } from '@/i18n'
import RewardsBoard, { parseRewardCard, type RewardCard } from '../RewardsBoard'
import { isValidIdempotencyKey } from '@/lib/idempotency-key'

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

const CLAIMED_MOVIE = { reward: { ...MOVIE, status: 'claimed', claimedById: 'kid_1', claimedByName: 'Sam' }, xp: 30 }
const GIVEN_ICE_CREAM = { reward: { ...ICE_CREAM, status: 'approved' } }

type Call = { url: string; method: string; body: any; headers?: Record<string, string> }

function mockFetch(answer: (url: string) => { status: number; body: unknown } | 'throw') {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body: init?.body ? JSON.parse(String(init.body)) : undefined, headers: init?.headers as Record<string, string> | undefined })
    const a = answer(url)
    if (a === 'throw') throw new TypeError('Failed to fetch')
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body } as Response
  }) as unknown as typeof fetch
  return calls
}

function renderBoard(props: Partial<React.ComponentProps<typeof RewardsBoard>> = {}, locale: 'en' | 'es' = 'en') {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <RewardsBoard rewards={[MOVIE, ICE_CREAM]} userXp={80} isParent={false} currentUserId="kid_1" canViewAnalytics={false} {...props} />
      </ToastProvider>
    </I18nProvider>
  )
}

beforeEach(() => refresh.mockReset())

describe('RewardsBoard', () => {
  it('keeps several rewards visible as separate choices', () => {
    renderBoard({ rewards: [MOVIE, { ...MOVIE, id: 'r_game', name: 'Game time', cost: 30 }] })
    expect(screen.getAllByTestId('claimable-reward')).toHaveLength(2)
    expect(screen.queryAllByTestId('family-reward')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Claim Game time' })).toBeTruthy()
  })

  it('parses the canonical inactive flag and keeps retired rewards out of the claim shelf', () => {
    expect(parseRewardCard({ ...MOVIE, is_active: false })?.active).toBe(false)
    renderBoard({ rewards: [{ ...MOVIE, active: false }] })
    expect(screen.queryAllByTestId('claimable-reward')).toHaveLength(0)
    const retired = screen.getByTestId('family-reward')
    expect(retired.textContent).toContain('Inactive')
    expect(within(retired).queryByRole('button', { name: /Claim/ })).toBeNull()
  })

  it('keeps an inactive claimed reward in pending review without duplicating it in history', () => {
    renderBoard({ rewards: [{ ...ICE_CREAM, active: false }], isParent: true, currentUserId: 'parent_1' })
    expect(screen.getAllByTestId('family-reward')).toHaveLength(1)
    expect(within(screen.getByRole('region', { name: 'Claimed' })).getByText('Ice cream')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'All family rewards' })).queryByText('Ice cream')).toBeNull()
  })

  it('retries an uncertain claim with the same idempotency key', async () => {
    const user = userEvent.setup()
    const requests: RequestInit[] = []
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      if (requests.length === 1) throw new TypeError('offline')
      return { ok: true, status: 200, json: async () => CLAIMED_MOVIE } as Response
    }) as unknown as typeof fetch
    renderBoard({ rewards: [MOVIE] })
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(requests[0].headers).toEqual(requests[1].headers)
    expect(isValidIdempotencyKey((requests[0].headers as Record<string, string>)['Idempotency-Key'])).toBe(true)
  })

  it('lets a parent add another reward once some exist; a child sees no add button', () => {
    const { unmount } = renderBoard({ isParent: true })
    const addReward = screen.getByRole('link', { name: 'Add reward' })
    expect(addReward.getAttribute('href')).toBe('/dashboard/rewards/create')
    const balance = screen.getByRole('region', { name: 'Your points' })
    expect(Boolean(addReward.compareDocumentPosition(balance) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    unmount()
    renderBoard({ isParent: false })
    expect(screen.queryByRole('link', { name: 'Add reward' })).toBeNull()
  })

  it('keeps the empty parent create action when no rewards exist', () => {
    renderBoard({ rewards: [], isParent: true })
    expect(screen.getByRole('link', { name: 'Create Reward' }).getAttribute('href')).toBe('/dashboard/rewards/create')
    expect(screen.queryByRole('link', { name: 'Add reward' })).toBeNull()
  })

  it('shows the analytics link only when the server grants the effective permission', () => {
    const { unmount } = renderBoard({ canViewAnalytics: true })
    expect(screen.getByRole('link', { name: /Leaderboard/ }).getAttribute('href')).toBe('/dashboard/analytics')
    unmount()
    renderBoard({ canViewAnalytics: false })
    expect(screen.queryByRole('link', { name: /Leaderboard/ })).toBeNull()
  })

  it('shows a gift instead of a stored word icon', () => {
    renderBoard({ rewards: [{ ...MOVIE, icon: 'tv' }] })
    expect(screen.queryByText('tv')).toBeNull()
    expect(screen.getAllByText('🎁').length).toBeGreaterThan(0)
  })

  it('claims a reward after confirming, then refreshes the page', async () => {
    const user = userEvent.setup()
    const calls = mockFetch(() => ({ status: 200, body: CLAIMED_MOVIE }))
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    const dialog = screen.getByRole('dialog', { name: 'Claim Movie night?' })
    expect(dialog.textContent).toContain('This uses 50 points')
    expect(calls).toHaveLength(0)
    await user.click(within(dialog).getByRole('button', { name: 'Claim' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({ url: '/api/rewards/claim', method: 'POST', body: { rewardId: 'r_movie' } }))
    expect(isValidIdempotencyKey((calls[0] as any).headers?.['Idempotency-Key'])).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Claimed Movie night')).toBeTruthy()
    expect(screen.getByText('30 points')).toBeTruthy()
  })

  it('does not confirm a claim when the response identity or owner is wrong', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({
      status: 200,
      body: { reward: { ...MOVIE, id: 'other', status: 'claimed', claimedById: 'someone-else' }, xp: 30 },
    }))
    renderBoard({ rewards: [MOVIE] })
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The connection dropped before we could confirm.')
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ['claimant is missing', {}],
    ['claimant is null', { claimedById: null }],
    ['claimant uses a null snake-case field', { claimed_by: null }],
  ] as const)('does not confirm a claim when %s', async (_label, claimant) => {
    const user = userEvent.setup()
    mockFetch(() => ({
      status: 200,
      body: { reward: { ...MOVIE, status: 'claimed', ...claimant }, xp: 30 },
    }))
    renderBoard({ rewards: [MOVIE] })
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    expect((await screen.findByRole('alert')).textContent).toContain('The connection dropped before we could confirm.')
    expect(refresh).not.toHaveBeenCalled()
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

  it('retains a claim key through an ambiguous server failure and retries safely', async () => {
    const user = userEvent.setup()
    const requests: RequestInit[] = []
    global.fetch = jest.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {})
      if (requests.length === 1) return { ok: false, status: 500, json: async () => ({ error: 'try later' }) } as Response
      return { ok: true, status: 200, json: async () => CLAIMED_MOVIE } as Response
    }) as unknown as typeof fetch
    renderBoard({ rewards: [MOVIE] })
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(requests[0].headers).toEqual(requests[1].headers)
    expect(isValidIdempotencyKey((requests[0].headers as Record<string, string>)['Idempotency-Key'])).toBe(true)
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

  it('uses singular Spanish point copy when one point is missing', () => {
    renderBoard({ rewards: [{ ...MOVIE, cost: 50 }], userXp: 49 }, 'es')
    const button = screen.getByRole('button', { name: 'Necesitas 1 punto más' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.getByText('50 puntos')).toBeTruthy()
  })

  it('localizes an approval transport recovery notice', async () => {
    const user = userEvent.setup()
    mockFetch(() => 'throw')
    renderBoard({ isParent: true, currentUserId: 'parent_1' }, 'es')
    await user.click(screen.getByRole('button', { name: 'Marcar Ice cream como entregada' }))
    const row = screen.getAllByTestId('family-reward').find((item) => item.textContent?.includes('Ice cream'))!
    expect(await within(row).findByText('Revisa tu conexión e inténtalo de nuevo.')).toBeTruthy()
    expect(within(row).queryByText('Check your connection and try again.')).toBeNull()
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
    const calls = mockFetch(() => ({ status: 200, body: GIVEN_ICE_CREAM }))
    renderBoard({ isParent: true, currentUserId: 'parent_1' })
    const row = screen.getAllByTestId('family-reward').find((r) => r.textContent?.includes('Ice cream'))!
    expect(row.textContent).toContain('Claimed by Sam')
    await user.click(within(row).getByRole('button', { name: 'Mark Ice cream as given' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(expect.objectContaining({ url: '/api/rewards/approve', method: 'POST', body: { rewardId: 'r_ice' } }))
    expect(isValidIdempotencyKey((calls[0] as any).headers?.['Idempotency-Key'])).toBe(true)
    expect(screen.getByText('Ice cream marked as given')).toBeTruthy()
  })

  it('does not confirm an approval for a different reward id', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 200, body: { reward: { ...ICE_CREAM, id: 'other', status: 'approved' } } }))
    renderBoard({ isParent: true, currentUserId: 'parent_1' })
    const row = screen.getAllByTestId('family-reward').find((item) => item.textContent?.includes('Ice cream'))!
    await user.click(within(row).getByRole('button', { name: 'Mark Ice cream as given' }))
    expect(await within(row).findByText('The connection dropped before we could confirm.')).toBeTruthy()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps separate recovery notices for two uncertain approvals', async () => {
    const user = userEvent.setup()
    mockFetch(() => ({ status: 500, body: { error: 'try later' } }))
    renderBoard({
      isParent: true,
      currentUserId: 'parent_1',
      rewards: [ICE_CREAM, { ...ICE_CREAM, id: 'r_game', name: 'Game time' }],
    })
    const rows = screen.getAllByTestId('family-reward')
    await user.click(within(rows[0]).getByRole('button', { name: 'Mark Ice cream as given' }))
    await user.click(within(rows[1]).getByRole('button', { name: 'Mark Game time as given' }))
    expect(screen.getAllByRole('button', { name: 'Try again' })).toHaveLength(2)
    expect(within(rows[0]).getByText('try later')).toBeTruthy()
    expect(within(rows[1]).getByText('try later')).toBeTruthy()
  })

  it('keeps approval recovery after a claimed status check and clears it only after redemption', async () => {
    const user = userEvent.setup()
    const requests: { url: string; headers?: Record<string, string> }[] = []
    let statusChecks = 0
    let approvalAttempts = 0
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, headers: init?.headers as Record<string, string> | undefined })
      if (url === '/api/rewards/approve') {
        approvalAttempts += 1
        return { ok: false, status: 500, json: async () => ({ error: 'try later' }) } as Response
      }
      statusChecks += 1
      return {
        ok: true,
        status: 200,
        json: async () => ({ rewards: [{ ...ICE_CREAM, status: statusChecks === 1 ? 'claimed' : 'redeemed' }] }),
      } as Response
    }) as unknown as typeof fetch
    renderBoard({ isParent: true, currentUserId: 'parent_1' })
    let row = screen.getAllByTestId('family-reward').find((item) => item.textContent?.includes('Ice cream'))!
    await user.click(within(row).getByRole('button', { name: 'Mark Ice cream as given' }))
    expect(within(row).getByText('try later')).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: 'Check status' }))
    expect(within(row).getByText('try later')).toBeTruthy()
    expect(screen.queryByText('Ice cream marked as given')).toBeNull()

    await user.click(within(row).getByRole('button', { name: 'Try again' }))
    expect(approvalAttempts).toBe(2)
    const approvalRequests = requests.filter((request) => request.url === '/api/rewards/approve')
    expect(approvalRequests[0].headers).toEqual(approvalRequests[1].headers)
    row = screen.getAllByTestId('family-reward').find((item) => item.textContent?.includes('Ice cream'))!
    expect(within(row).getByText('try later')).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: 'Check status' }))
    await waitFor(() => expect(screen.getByText('Ice cream marked as given')).toBeTruthy())
    expect(screen.queryByText('try later')).toBeNull()
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

it('labels the current reward page and provides explicit older/newest links', () => {
  renderBoard({ pageInfo: { older: true, nextCursor: 'fixture-cursor' } })
  expect(screen.getByText('This page shows 2 rewards. Choices and history below apply to this page.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Older rewards' }).getAttribute('href')).toBe('/dashboard/rewards?cursor=fixture-cursor')
  expect(screen.getByRole('link', { name: 'Newest rewards' }).getAttribute('href')).toBe('/dashboard/rewards')
  expect(screen.queryByText('All family rewards')).toBeNull()
})
it('retains a closed uncertain claim for review and holds page navigation after a still-available status read', async () => {
  const calls = mockFetch(url => url === '/api/rewards/claim' ? 'throw' : { status: 200, body: { rewards: [MOVIE] } })
  const user = userEvent.setup()
  renderBoard({ pageInfo: { older: false, nextCursor: 'fixture-cursor' } })
  await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
  await within(screen.getByRole('dialog')).findByText('Check status')
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByRole('link', { name: 'Older rewards' }).getAttribute('aria-disabled')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'Check status' }))
  await waitFor(() => expect(calls.some(call => call.url === '/api/rewards?rewardId=r_movie')).toBe(true))
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Older rewards' }).getAttribute('aria-disabled')).toBe('true')
  expect(calls.filter(call => call.method === 'POST')).toHaveLength(1)
})

// Source-only transport regressions; current no-QA instruction defers execution.
it('settles an abort-ignoring claim deadline and retries with the original key/body', async () => {
  jest.useFakeTimers()
  try {
    const calls: Array<{ body: unknown; headers: HeadersInit | undefined }> = []
    global.fetch = jest.fn(async (_input, init) => {
      calls.push({ body: init?.body, headers: init?.headers })
      if (calls.length === 1) return await new Promise<Response>(() => {})
      return { ok: true, status: 200, json: async () => CLAIMED_MOVIE } as Response
    }) as typeof fetch
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    renderBoard({ pageInfo: { older: false, nextCursor: 'fixture-cursor' } })
    await user.click(screen.getByRole('button', { name: 'Claim Movie night' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }))
    await act(async () => { jest.advanceTimersByTime(15_001) })
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('link', { name: 'Older rewards' }).getAttribute('aria-disabled')).toBe('true')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls).toHaveLength(2)
    expect(calls[1].body).toBe(calls[0].body)
    expect(new Headers(calls[1].headers).get('Idempotency-Key')).toBe(new Headers(calls[0].headers).get('Idempotency-Key'))
    expect(screen.getByRole('link', { name: 'Older rewards' }).getAttribute('aria-disabled')).toBe('false')
  } finally { jest.useRealTimers() }
})
it('keeps an oversized approval receipt uncertain and reuses the original key on explicit retry', async () => {
  const calls: RequestInit[] = []
  const decode = jest.fn(async () => GIVEN_ICE_CREAM)
  global.fetch = jest.fn(async (_input, init) => {
    calls.push(init ?? {})
    return calls.length === 1
      ? { ok: true, status: 200, headers: new Headers({ 'content-length': '1048576' }), json: decode } as unknown as Response
      : { ok: true, status: 200, json: async () => GIVEN_ICE_CREAM } as Response
  }) as typeof fetch
  const user = userEvent.setup()
  renderBoard({ isParent: true, currentUserId: 'parent_1' })
  await user.click(screen.getByRole('button', { name: 'Mark Ice cream as given' }))
  await screen.findByRole('button', { name: 'Try again' })
  expect(decode).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Ice cream marked as given')
  expect(calls).toHaveLength(2)
  expect(calls[1].body).toBe(calls[0].body)
  expect(new Headers(calls[1].headers).get('Idempotency-Key')).toBe(new Headers(calls[0].headers).get('Idempotency-Key'))
})


// Authored UNRUN: a later refusal never proves the first attempt rolled back.
it('retains the original uncertain approval key across a later known refusal', async () => {
  const calls: RequestInit[] = [];
  global.fetch = jest.fn(async (_input, init) => {
    calls.push(init ?? {});
    const status = calls.length === 1 ? 500 : calls.length === 2 ? 403 : 200;
    return { ok: status === 200, status, json: async () => status === 200 ? GIVEN_ICE_CREAM : { error: status === 500 ? 'First outcome unknown' : 'Later access refusal' } } as Response;
  }) as typeof fetch;
  const user = userEvent.setup();
  renderBoard({ rewards: [ICE_CREAM], isParent: true, currentUserId: 'parent_1' });
  await user.click(screen.getByRole('button', { name: 'Mark Ice cream as given' }));
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  await screen.findByText('Later access refusal');
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls).toHaveLength(3);
  expect(calls.every(call => call.body === calls[0].body)).toBe(true);
  expect(calls.every(call => new Headers(call.headers).get('Idempotency-Key') === new Headers(calls[0].headers).get('Idempotency-Key'))).toBe(true);
});
it('holds a first late-access response as uncertain rather than inventing a fresh key', async () => {
  const calls: RequestInit[] = [];
  global.fetch = jest.fn(async (_input, init) => {
    calls.push(init ?? {});
    return calls.length === 1 ? { ok: false, status: 401, json: async () => ({ error: 'May already be saved', code: 'REWARD_ACCESS_CHANGED' }) } as Response
      : { ok: true, status: 200, json: async () => CLAIMED_MOVIE } as Response;
  }) as typeof fetch;
  const user = userEvent.setup(); renderBoard({ rewards: [MOVIE] });
  await user.click(screen.getByRole('button', { name: 'Claim Movie night' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }));
  await user.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  expect(calls[1].headers).toEqual(calls[0].headers); expect(calls[1].body).toBe(calls[0].body);
});
it('does not resolve an uncertain own claim from another account’s current claim', async () => {
  mockFetch(url => url === '/api/rewards/claim' ? 'throw' : { status: 200, body: { rewards: [{ ...MOVIE, status: 'claimed', claimedById: 'another-child', claimedByName: 'Fixture other' }] } });
  const user = userEvent.setup(); renderBoard({ rewards: [MOVIE] });
  await user.click(screen.getByRole('button', { name: 'Claim Movie night' }));
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Claim' }));
  await user.click(await screen.findByRole('button', { name: 'Check status' }));
  await screen.findByText('The current reward does not confirm your original request. Keep this recovery and check again.');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy(); expect(refresh).not.toHaveBeenCalled();
});
