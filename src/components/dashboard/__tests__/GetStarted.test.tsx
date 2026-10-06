/**
 * @jest-environment jsdom
 */
// Get started card: three first steps for a parent of a new household, each
// ticked from real data, gone when all are done or after Hide (with Undo).
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GetStarted, { getStartedStorageKey, type GetStartedProps } from '../GetStarted'
import { ToastProvider } from '@/components/ui/toast'
import { serverRenderThenHydrate } from '@/components/ui/__tests__/ssr-hydration'

const FAMILY = 'fam_new'
const none = { invited: false, hasChore: false, hasEvent: false }

function renderCard(props: Partial<GetStartedProps> = {}) {
  return render(
    <ToastProvider>
      <GetStarted viewer={{ role: 'parent' }} familyId={FAMILY} steps={none} {...props} />
    </ToastProvider>
  )
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('GetStarted', () => {
  it('keeps original setup art compact and presents the real steps as a tablet row', () => {
    renderCard()
    const card = screen.getByTestId('get-started')
    expect(card.querySelector('video, img')?.className).toContain('w-16')
    expect(within(card).getByRole('list', { name: 'Setup steps' }).className).toContain('md:grid-cols-3')
  })
  it('lists the three steps with links and their status in words', () => {
    renderCard()
    const card = screen.getByRole('region', { name: 'Get started' })
    expect(within(card).getByTestId('get-started-progress').textContent).toContain('0 of 3 done')
    const items = within(within(card).getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)

    const invite = within(items[0]).getByRole('link')
    expect(invite.getAttribute('href')).toBe('/dashboard/family/invite')
    expect(invite.textContent).toContain('To do: Invite your family')
    expect(within(items[1]).getByRole('link').getAttribute('href')).toBe('/dashboard/chores/create')
    expect(items[1].textContent).toContain('Add your first chore')
    expect(within(items[2]).getByRole('link').getAttribute('href')).toBe('/dashboard/calendar/create')
    expect(items[2].textContent).toContain('Add an event')
  })

  it('marks finished steps done in text, not colour alone', () => {
    renderCard({ steps: { invited: true, hasChore: false, hasEvent: true } })
    expect(screen.getByTestId('get-started-progress').textContent).toContain('2 of 3 done')
    const invite = screen.getByTestId('get-started-invite')
    expect(invite.textContent).toContain('Done')
    expect(invite.textContent).not.toContain('To do')
    const chore = screen.getByTestId('get-started-chore')
    expect(chore.textContent).toContain('To do: Add your first chore')
    expect(chore.textContent).not.toMatch(/Done$/)
    expect(screen.getByTestId('get-started-event').textContent).toContain('Done')
  })

  it('is gone once all three steps are done', () => {
    renderCard({ steps: { invited: true, hasChore: true, hasEvent: true } })
    expect(screen.queryByTestId('get-started')).toBeNull()
  })

  it.each(['teen', 'child'])('is never shown to a %s', (role) => {
    renderCard({ viewer: { role } })
    expect(screen.queryByTestId('get-started')).toBeNull()
  })

  it('Hide removes it, remembers it for this household, and Undo brings it back', async () => {
    const user = userEvent.setup()
    const { unmount } = renderCard()
    await user.click(screen.getByRole('button', { name: 'Hide get started' }))
    expect(screen.queryByTestId('get-started')).toBeNull()
    expect(window.localStorage.getItem(getStartedStorageKey(FAMILY))).toBe('1')

    const toast = await screen.findByTestId('undo-toast')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(screen.getByTestId('get-started')).toBeTruthy()
    expect(window.localStorage.getItem(getStartedStorageKey(FAMILY))).toBeNull()
    unmount()
  })

  it('stays hidden on a later visit, but only for that household', () => {
    window.localStorage.setItem(getStartedStorageKey(FAMILY), '1')
    const { unmount } = renderCard()
    expect(screen.queryByTestId('get-started')).toBeNull()
    unmount()

    renderCard({ familyId: 'fam_other' })
    expect(screen.getByTestId('get-started')).toBeTruthy()
  })

  it('still hides for this visit when storage throws', async () => {
    const user = userEvent.setup()
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      renderCard()
      expect(screen.getByTestId('get-started')).toBeTruthy()
      await user.click(screen.getByRole('button', { name: 'Hide get started' }))
      expect(screen.queryByTestId('get-started')).toBeNull()
    } finally {
      setItem.mockRestore()
      getItem.mockRestore()
    }
  })

  it('hydrates without a mismatch when Hide was stored, then hides', () => {
    jest.useFakeTimers()
    window.localStorage.setItem(getStartedStorageKey(FAMILY), '1')
    const now = new Date(2026, 9, 2, 9, 0)
    const hydrated = serverRenderThenHydrate(
      <ToastProvider>
        <GetStarted viewer={{ role: 'parent' }} familyId={FAMILY} steps={none} />
      </ToastProvider>,
      { serverNow: now, clientNow: now }
    )
    try {
      // The server cannot read storage: its HTML has the card.
      expect(hydrated.html).toContain('data-testid="get-started"')
      expect(hydrated.errors).toEqual([])
      expect(hydrated.recoverable).toEqual([])
      // The stored choice applies right after hydration.
      expect(hydrated.container.querySelector('[data-testid="get-started"]')).toBeNull()
    } finally {
      hydrated.unmount()
      jest.useRealTimers()
    }
  })
})
