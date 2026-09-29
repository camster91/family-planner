/**
 * @jest-environment jsdom
 */
// "Use soon" tile (#263 data in the slot #262 reserved).
import * as React from 'react'
import { act, render, screen, within } from '@testing-library/react'
import TodayBoard from '../TodayBoard'
import { itemsToUseSoon } from '../board-model'
import { UseSoonRegion } from '../use-soon-region'
import type { BoardUseSoonItem, TodayBoardData } from '@/app/dashboard/today/today-board-data'

jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))

// Local noon on Monday 5 January 2026 in whatever zone the test runs in.
const NOW = new Date(2026, 0, 5, 12, 0, 0)

const item = (
  id: string,
  name: string,
  expiresOn: string,
  location: BoardUseSoonItem['location'] = 'fridge',
  dateKind?: BoardUseSoonItem['dateKind']
): BoardUseSoonItem => ({
  id,
  name,
  location,
  expiresOn,
  ...(dateKind ? { dateKind } : {}),
})

function board(useSoon: BoardUseSoonItem[] | null | undefined, inventoryHref: string | null = null): TodayBoardData {
  return {
    generatedAt: NOW.toISOString(),
    members: [],
    events: [],
    chores: [],
    dinners: [],
    shopping: { items: [], total: 0 },
    links: { calendar: null, chores: null, meals: null, lists: null, features: null, inventory: inventoryHref },
    weather: null,
    useSoon,
  }
}

async function renderBoard(data: TodayBoardData) {
  jest.useFakeTimers({ now: NOW })
  const utils = render(<TodayBoard data={data} fridgeMode />)
  await act(async () => {
    jest.advanceTimersByTime(0)
  })
  return utils
}

afterEach(() => jest.useRealTimers())

describe('itemsToUseSoon', () => {
  it("labels against the viewer's local day and drops rows not yet due", () => {
    const out = itemsToUseSoon(
      [
        item('b', 'Yogurt', '2026-01-08'),
        item('a', 'Spinach', '2026-01-03'),
        item('c', 'Milk', '2026-01-05'),
        item('d', 'Jam', '2026-01-09', 'pantry'),
        item('e', 'Bread', '2026-01-06', 'pantry'),
      ],
      NOW
    )
    expect(out.map((i) => [i.name, i.status, i.label])).toEqual([
      ['Spinach', 'expired', 'Best before was 2 days ago'],
      ['Milk', 'today', 'Best before today'],
      ['Bread', 'soon', 'Best before tomorrow'],
      ['Yogurt', 'soon', 'Best before in 3 days'],
    ])
    expect(itemsToUseSoon(null, NOW)).toEqual([])
    expect(itemsToUseSoon(undefined, NOW)).toEqual([])
  })

  it('use-by (#158): a passed day is dropped (never "use soon"), and use-by sorts first on the same day', () => {
    const out = itemsToUseSoon(
      [
        item('a', 'Old chicken', '2026-01-04', 'fridge', 'use_by'),
        item('b', 'Apples', '2026-01-06'),
        item('c', 'Ham', '2026-01-06', 'fridge', 'use_by'),
        item('d', 'Fish', '2026-01-05', 'fridge', 'use_by'),
        item('e', 'Stock', '2026-01-08', 'pantry', 'use_by'),
      ],
      NOW
    )
    expect(out.map((i) => [i.name, i.status, i.label])).toEqual([
      ['Fish', 'today', 'Use by today'],
      ['Ham', 'soon', 'Use by tomorrow'],
      ['Apples', 'soon', 'Best before tomorrow'],
      ['Stock', 'soon', 'Use within 3 days'],
    ])
  })
})

describe('UseSoonRegion', () => {
  it('shows name, state in words and place; expired rows are marked with text and an icon', () => {
    const items = itemsToUseSoon([item('a', 'Spinach', '2026-01-04'), item('b', 'Peas', '2026-01-07', 'freezer')], NOW)
    render(<UseSoonRegion items={items} inventoryHref={null} />)
    const region = screen.getByRole('region', { name: 'Use soon' })
    const rows = within(region).getAllByTestId('use-soon-item')
    expect(rows.map((r) => r.textContent)).toEqual(['SpinachBest before was yesterday·Fridge', 'PeasBest before in 2 days·Freezer'])
    expect(rows[0].getAttribute('data-status')).toBe('expired')
    expect(rows[0].querySelector('svg')).not.toBeNull()
    expect(rows[1].querySelector('svg')).toBeNull()
    // Read-only: no link without an inventory href (device).
    expect(within(region).queryByRole('link')).toBeNull()
  })

  it('caps at five rows with "N more" text, and links to inventory for a person', () => {
    const items = itemsToUseSoon(
      Array.from({ length: 7 }, (_, i) => item(`i${i}`, `Item ${i}`, '2026-01-06')),
      NOW
    )
    render(<UseSoonRegion items={items} inventoryHref="/dashboard/inventory" />)
    expect(screen.getAllByTestId('use-soon-item')).toHaveLength(5)
    expect(screen.getByTestId('use-soon-more').textContent).toBe('2 more to use soon')
    expect(screen.getByRole('link', { name: 'Open inventory' }).getAttribute('href')).toBe('/dashboard/inventory')
  })

  it('renders nothing when there is nothing to use', () => {
    const { container } = render(<UseSoonRegion items={[]} inventoryHref={null} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('TodayBoard use soon slot', () => {
  it('fills the usesoon area from the DTO when something is due', async () => {
    await renderBoard(board([item('a', 'Spinach', '2026-01-05')], '/dashboard/inventory'))
    const slot = screen.getByTestId('board-slot-use-soon')
    expect(within(slot).getByRole('heading', { name: 'Use soon' })).toBeTruthy()
    expect(within(slot).getByTestId('use-soon-item').textContent).toContain('Best before today')
  })

  it.each([
    ['inventory off', null],
    ['older server', undefined],
    ['nothing due yet', [item('a', 'Jam', '2026-02-01', 'pantry')]],
    ['empty', []],
  ])('leaves the slot out (%s)', async (_label, useSoon) => {
    await renderBoard(board(useSoon as BoardUseSoonItem[] | null | undefined))
    expect(screen.queryByTestId('board-slot-use-soon')).toBeNull()
    expect(screen.getByTestId('board-grid').className).not.toContain('usesoon')
  })
})
