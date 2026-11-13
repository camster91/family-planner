/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import { BellUnreadDot, bellCountLabel, useBellUnread } from '../BellUnreadDot'
import { REMINDER_TIME_ZONE_HEADER } from '@/lib/event-reminders'

function Bell({ enabled, pathname = '/dashboard' }: { enabled: boolean; pathname?: string }) {
  const unread = useBellUnread(enabled, pathname)
  return <a aria-label={unread > 0 ? `Notifications, ${bellCountLabel(unread)} unread` : 'Notifications'}>{unread > 0 && <BellUnreadDot count={unread} />}</a>
}
const reply = (notifications: unknown[], ok = true) => jest.fn(async () => ({ ok, json: async () => ({ notifications }) })) as unknown as typeof fetch

describe('bell unread dot', () => {
  it('does not ask or show anything when reminders are off', () => {
    global.fetch = reply([{ id: 'n' }])
    render(<Bell enabled={false} />)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bell-unread-dot')).toBeNull()
  })
  it('asks for unread rows with the browser zone, shows the count, and re-checks on a page change', async () => {
    global.fetch = reply([{ id: 'n' }, { id: 'm' }, { id: 'o' }])
    const view = render(<Bell enabled />)
    expect((await screen.findByTestId('bell-unread-dot')).textContent).toBe('3')
    expect(screen.getByLabelText('Notifications, 3 unread')).toBeTruthy()
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/notifications?unread=true&limit=10')
    expect(options.headers[REMINDER_TIME_ZONE_HEADER]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    global.fetch = reply([])
    view.rerender(<Bell enabled pathname="/dashboard/notifications" />)
    await waitFor(() => expect(screen.queryByTestId('bell-unread-dot')).toBeNull())
    expect(screen.getByLabelText('Notifications')).toBeTruthy()
  })
  it('shows 9+ once there are more than nine', async () => {
    global.fetch = reply(Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` })))
    render(<Bell enabled />)
    expect((await screen.findByTestId('bell-unread-dot')).textContent).toBe('9+')
    expect(screen.getByLabelText('Notifications, 9+ unread')).toBeTruthy()
  })
  it('shows no dot when the read fails', async () => {
    global.fetch = reply([{ id: 'n' }], false)
    render(<Bell enabled />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('bell-unread-dot')).toBeNull()
    global.fetch = jest.fn(async () => { throw new Error('offline') }) as unknown as typeof fetch
    render(<Bell enabled pathname="/x" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('bell-unread-dot')).toBeNull()
  })
})
