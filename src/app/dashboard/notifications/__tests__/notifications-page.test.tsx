/**
 * @jest-environment jsdom
 */
// Notifications: a failed load says so (with Try again) instead of "No
// notifications yet"; mark-read and delete failures show a toast; unread is
// announced in text and has its own button; delete waits out an Undo toast.
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, UNDO_TOAST_MS } from '@/components/ui/toast'
import NotificationsPage from '../page'

const UNREAD = { id: 'n1', type: 'chore', title: 'Dishes done', message: 'Sam finished the dishes', read: false, created_at: '2026-09-30T10:00:00.000Z' }
const READ = { id: 'n2', type: 'event', title: 'Swim lesson', message: 'Tomorrow at 4', read: true, created_at: '2026-09-29T10:00:00.000Z' }

type Call = { url: string; method: string; body: any }
type Answer = { status: number; body: unknown } | 'throw'

function mockFetch(answer: (method: string, url: string) => Answer) {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const a = answer(method, url)
    if (a === 'throw') throw new TypeError('Failed to fetch')
    return { ok: a.status >= 200 && a.status < 300, status: a.status, json: async () => a.body } as Response
  }) as unknown as typeof fetch
  return calls
}

const list = (): Answer => ({ status: 200, body: { notifications: [UNREAD, READ] } })

function renderPage() {
  return render(
    <ToastProvider>
      <NotificationsPage />
    </ToastProvider>
  )
}

afterEach(() => jest.useRealTimers())

describe('/dashboard/notifications', () => {
  it('shows a load error with a working retry, not the empty state', async () => {
    const user = userEvent.setup()
    let fail = true
    const calls = mockFetch(() => (fail ? { status: 500, body: { error: 'Internal server error' } } : list()))
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't load notifications")
    expect(screen.queryByText('No notifications yet')).toBeNull()
    fail = false
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Swim lesson')).toBeTruthy()
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('shows the offline line when the list cannot be fetched', async () => {
    mockFetch(() => 'throw')
    renderPage()
    expect((await screen.findByRole('alert')).textContent).toContain('Check your connection and try again.')
  })

  it('marks unread in text and offers a Mark read button only on unread rows', async () => {
    mockFetch(list)
    renderPage()
    const rows = await screen.findAllByTestId('notification-row')
    expect(rows[0].textContent).toContain('Unread: Dishes done')
    expect(rows[1].textContent).not.toContain('Unread')
    expect(within(rows[0]).getByRole('button', { name: 'Mark "Dishes done" as read' })).toBeTruthy()
    expect(within(rows[1]).queryByRole('button', { name: /as read/ })).toBeNull()
    // Delete is a real 44px target.
    expect(within(rows[1]).getByRole('button', { name: 'Delete "Swim lesson"' }).className).toContain('min-h-[44px]')
  })

  it('marks a notification read with the keyboard-usable button', async () => {
    const user = userEvent.setup()
    const calls = mockFetch((method) => (method === 'PATCH' ? { status: 200, body: { success: true } } : list()))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Mark "Dishes done" as read' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mark "Dishes done" as read' })).toBeNull())
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ notificationId: 'n1' })
    expect(screen.getByText('All caught up')).toBeTruthy()
  })

  it('shows a toast when marking read fails and keeps it unread', async () => {
    const user = userEvent.setup()
    mockFetch((method) => (method === 'PATCH' ? { status: 404, body: { error: 'Notification not found' } } : list()))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Mark "Dishes done" as read' }))
    expect(await screen.findByText('Notification not found')).toBeTruthy()
    expect(screen.getByText("Couldn't mark it as read")).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark "Dishes done" as read' })).toBeTruthy()
  })

  it('deletes after the Undo window, and Undo keeps it', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    const calls = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { success: true } } : list()))
    renderPage()

    // Undo: the row comes back and nothing is sent.
    await user.click(await screen.findByRole('button', { name: 'Delete "Swim lesson"' }))
    expect(screen.queryByText('Swim lesson')).toBeNull()
    const toast = screen.getByTestId('undo-toast')
    expect(toast.textContent).toContain('Notification deleted')
    await user.click(within(toast).getByRole('button', { name: 'Undo' }))
    expect(screen.getByText('Swim lesson')).toBeTruthy()
    await act(async () => {
      jest.advanceTimersByTime(UNDO_TOAST_MS + 2000)
    })
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    // No Undo: the delete is sent once the window has passed.
    await user.click(screen.getByRole('button', { name: 'Delete "Swim lesson"' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await act(async () => {
      jest.advanceTimersByTime(UNDO_TOAST_MS + 2000)
    })
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ notificationId: 'n2' }])
    expect(screen.queryByText('Swim lesson')).toBeNull()
  })

  it('puts the row back with an error toast when the delete fails', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    mockFetch((method) => (method === 'DELETE' ? { status: 500, body: { error: 'Internal server error' } } : list()))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete "Swim lesson"' }))
    await act(async () => {
      jest.advanceTimersByTime(UNDO_TOAST_MS + 2000)
    })
    expect(await screen.findByText("Couldn't delete the notification")).toBeTruthy()
    expect(screen.getByText('Swim lesson')).toBeTruthy()
  })

  it('sends a waiting delete when the page is left', async () => {
    const user = userEvent.setup()
    const calls = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { success: true } } : list()))
    const { unmount } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete "Swim lesson"' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    unmount()
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ notificationId: 'n2' }])
  })

  const deleteInits = () =>
    (global.fetch as jest.Mock).mock.calls
      .map(([, init]) => init as RequestInit | undefined)
      .filter((init) => init?.method === 'DELETE')

  it('sends a waiting delete (keepalive) when the page is reloaded or closed, once', async () => {
    const user = userEvent.setup()
    const calls = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { success: true } } : list()))
    const { unmount } = renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete "Swim lesson"' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ notificationId: 'n2' }])
    expect(deleteInits().map((init) => init?.keepalive)).toEqual([true])

    // Nothing is left waiting, so leaving later sends nothing more.
    unmount()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1)
  })

  it('sends a waiting delete when the app goes to the background', async () => {
    const user = userEvent.setup()
    const calls = mockFetch((method) => (method === 'DELETE' ? { status: 200, body: { success: true } } : list()))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Delete "Swim lesson"' }))

    const visibility = jest.spyOn(document, 'visibilityState', 'get')
    try {
      visibility.mockReturnValue('visible')
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

      visibility.mockReturnValue('hidden')
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.body)).toEqual([{ notificationId: 'n2' }])
      expect(deleteInits().map((init) => init?.keepalive)).toEqual([true])
    } finally {
      visibility.mockRestore()
    }
  })
})

it('snoozes, excludes unread counts, and restores early with Show now', async () => {
 const user=userEvent.setup()
 const until=new Date(Date.now()+3600_000).toISOString()
 let snoozed=false
 const calls=mockFetch((method,url)=>{
   if(method==='PATCH' && url.endsWith('/snooze')) { snoozed=!snoozed;return {status:200,body:{success:true,snoozed_until:snoozed?until:null}} }
   return list()
 })
 renderPage()
 await user.selectOptions(await screen.findByRole('combobox',{name:'Snooze "Dishes done"'}),'60')
 await waitFor(()=>expect(screen.queryByRole('combobox',{name:'Snooze "Dishes done"'})).toBeNull())
 expect(screen.getByRole('button',{name:'Unread (0)'})).toBeTruthy()
 await user.click(screen.getByRole('button',{name:'Snoozed (1)'}))
 await user.click(screen.getByRole('button',{name:'Show "Dishes done" now'}))
 await waitFor(()=>expect(screen.getByRole('button',{name:'Snoozed (0)'})).toBeTruthy())
 expect(calls.filter(c=>c.method==='PATCH').map(c=>c.body)).toEqual([{notificationId:'n1',minutes:60},{notificationId:'n1',minutes:null}])
})
it('keeps the row when snoozing fails',async()=>{
 const user=userEvent.setup()
 mockFetch(method=>method==='PATCH'?{status:500,body:{error:'Try later'}}:list())
 renderPage()
 await user.selectOptions(await screen.findByRole('combobox',{name:'Snooze "Dishes done"'}),'15')
 expect(await screen.findByText("Couldn't change snooze")).toBeTruthy()
 expect(screen.getByRole('combobox',{name:'Snooze "Dishes done"'})).toBeTruthy()
})
it('returns an expired snooze to unread without creating another notification',async()=>{
 jest.useFakeTimers({now:new Date('2026-10-09T12:00:00Z')})
 mockFetch(()=>({status:200,body:{notifications:[{...UNREAD,snoozed_until:new Date(Date.now()+60_000).toISOString()}]}}))
 renderPage()
 await act(async()=>{})
 expect(screen.getByRole('button',{name:'Snoozed (1)'})).toBeTruthy()
 await act(async()=>{jest.advanceTimersByTime(60_000)})
 expect(screen.getByRole('button',{name:'Snoozed (0)'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'Unread (1)'})).toBeTruthy()
})
