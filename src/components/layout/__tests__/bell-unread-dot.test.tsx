/** @jest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react'
import { BellUnreadDot, useBellUnread } from '../BellUnreadDot'
import { REMINDER_TIME_ZONE_HEADER } from '@/lib/event-reminders'

function Bell({ enabled, pathname = '/dashboard' }: { enabled: boolean; pathname?: string }) {
  const unread = useBellUnread(enabled, pathname)
  return <a aria-label={unread ? 'Notifications, unread' : 'Notifications'}>{unread && <BellUnreadDot />}</a>
}
const reply = (notifications: unknown[], ok = true) => jest.fn(async () => ({ ok, json: async () => ({ notifications }) })) as unknown as typeof fetch

describe('bell unread dot', () => {
  it('does not ask or show anything when reminders are off', () => {
    global.fetch = reply([{ id: 'n' }])
    render(<Bell enabled={false} />)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('bell-unread-dot')).toBeNull()
  })
  it('asks for one unread row with the browser zone, shows the dot, and re-checks on a page change', async () => {
    global.fetch = reply([{ id: 'n' }])
    const view = render(<Bell enabled />)
    await screen.findByTestId('bell-unread-dot')
    expect(screen.getByLabelText('Notifications, unread')).toBeTruthy()
    const [url, options] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe('/api/notifications?unread=true&limit=1')
    expect(options.headers[REMINDER_TIME_ZONE_HEADER]).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    global.fetch = reply([])
    view.rerender(<Bell enabled pathname="/dashboard/notifications" />)
    await waitFor(() => expect(screen.queryByTestId('bell-unread-dot')).toBeNull())
    expect(screen.getByLabelText('Notifications')).toBeTruthy()
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
