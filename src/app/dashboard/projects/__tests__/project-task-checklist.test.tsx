/**
 * @jest-environment jsdom
 */
// Project detail task list and "Send to Calendar" (client components). The
// page used to pass inline handlers from a server component, which throws on
// render and left tasks impossible to tick.
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectTaskChecklist, type ChecklistTask } from '../[id]/ProjectTaskChecklist'
import { SendToCalendarButton } from '../[id]/SendToCalendarButton'
import { ToastProvider } from '@/components/ui/toast'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn() }) }))

type Call = { url: string; method: string; body: any }
let calls: Call[] = []
let reply: { status: number; body: unknown } | 'network' = { status: 200, body: {} }

beforeEach(() => {
  calls = []
  mockRefresh.mockClear()
  reply = { status: 200, body: { task: {} } }
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    if (reply === 'network') throw new TypeError('Failed to fetch')
    const { status, body } = reply
    return { ok: status < 300, status, json: async () => body } as Response
  }) as unknown as typeof fetch
})

const tasks: ChecklistTask[] = [
  { id: 't1', title: 'Sweep floor', completed: false, due_date: '2026-10-15T00:00:00.000Z' },
  { id: 't2', title: 'Hang shelves', completed: true, due_date: null },
]

function renderList(props: Partial<React.ComponentProps<typeof ProjectTaskChecklist>> = {}) {
  return render(
    <ToastProvider>
      <ProjectTaskChecklist projectId="p1" tasks={tasks} canToggle {...props} />
    </ToastProvider>
  )
}

describe('ProjectTaskChecklist', () => {
  it('renders each task as a full-row checkbox (>= 44px) with its date-only due day', () => {
    renderList()
    const sweep = screen.getByRole('checkbox', { name: /Sweep floor/ })
    expect(sweep.getAttribute('aria-checked')).toBe('false')
    expect(sweep.className).toMatch(/min-h-\[52px\]/)
    // Formatted in UTC, so the stored day never slips to the day before.
    expect(sweep.textContent).toContain('Thu, Oct 15')
    expect(screen.getByRole('checkbox', { name: /Hang shelves/ }).getAttribute('aria-checked')).toBe('true')
  })

  it('ticks at once, saves through the task PATCH API and refreshes the page', async () => {
    const user = userEvent.setup()
    // Hold the request open to observe the optimistic state.
    let resolve!: () => void
    const gate = new Promise<void>((r) => (resolve = r))
    ;(global.fetch as jest.Mock).mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), method: String(init?.method), body: JSON.parse(String(init?.body)) })
      await gate
      return { ok: true, status: 200, json: async () => ({ task: {} }) } as Response
    })
    renderList()
    const sweep = screen.getByRole('checkbox', { name: /Sweep floor/ })
    await user.click(sweep)
    expect(sweep.getAttribute('aria-checked')).toBe('true')
    expect(sweep.getAttribute('aria-disabled')).toBe('true')
    expect(calls).toEqual([{ url: '/api/projects/p1/tasks/t1', method: 'PATCH', body: { completed: true } }])
    resolve()
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    expect(sweep.getAttribute('aria-checked')).toBe('true')
    expect(sweep.getAttribute('aria-disabled')).toBeNull()
  })

  it('un-ticks a done task', async () => {
    const user = userEvent.setup()
    renderList()
    await user.click(screen.getByRole('checkbox', { name: /Hang shelves/ }))
    expect(calls[0].body).toEqual({ completed: false })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
  })

  it('puts the tick back and shows the API error when the save fails', async () => {
    const user = userEvent.setup()
    reply = { status: 403, body: { error: 'Only parents can do that' } }
    renderList()
    const sweep = screen.getByRole('checkbox', { name: /Sweep floor/ })
    await user.click(sweep)
    expect(await screen.findByText('Could not update task')).toBeTruthy()
    expect(screen.getByText('Only parents can do that')).toBeTruthy()
    expect(sweep.getAttribute('aria-checked')).toBe('false')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('rolls back on a network failure too', async () => {
    const user = userEvent.setup()
    reply = 'network'
    renderList()
    const sweep = screen.getByRole('checkbox', { name: /Sweep floor/ })
    await user.click(sweep)
    expect(await screen.findByText('Check your connection and try again.')).toBeTruthy()
    expect(sweep.getAttribute('aria-checked')).toBe('false')
  })

  it('shows tasks read-only when the viewer cannot change them', async () => {
    const user = userEvent.setup()
    renderList({ canToggle: false })
    const sweep = screen.getByRole('checkbox', { name: /Sweep floor/ })
    expect(sweep.getAttribute('aria-disabled')).toBe('true')
    await user.click(sweep)
    expect(sweep.getAttribute('aria-checked')).toBe('false')
    expect(calls).toHaveLength(0)
  })

  it('follows fresh server data after a refresh', () => {
    const { rerender } = renderList()
    rerender(
      <ToastProvider>
        <ProjectTaskChecklist projectId="p1" tasks={[{ ...tasks[0], completed: true }, tasks[1]]} canToggle />
      </ToastProvider>
    )
    expect(screen.getByRole('checkbox', { name: /Sweep floor/ }).getAttribute('aria-checked')).toBe('true')
  })
})

describe('SendToCalendarButton', () => {
  function renderButton() {
    render(
      <ToastProvider>
        <SendToCalendarButton projectId="p1" />
      </ToastProvider>
    )
    return screen.getByRole('button', { name: 'Send to Calendar' })
  }

  it('is a 44px target that posts the viewer time zone and reports the count', async () => {
    const user = userEvent.setup()
    reply = { status: 200, body: { eventsCreated: 2 } }
    const button = renderButton()
    expect(button.className).toMatch(/min-h-\[44px\]/)
    await user.click(button)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('/api/projects/p1/send-to-calendar')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    expect(await screen.findByText('Added 2 tasks to the calendar')).toBeTruthy()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('says when nothing new was added', async () => {
    const user = userEvent.setup()
    reply = { status: 200, body: { eventsCreated: 0 } }
    await user.click(renderButton())
    expect(await screen.findByText('Nothing new to add')).toBeTruthy()
  })

  it('shows the API error when the request fails', async () => {
    const user = userEvent.setup()
    reply = { status: 404, body: { error: 'Project not found' } }
    await user.click(renderButton())
    expect(await screen.findByText('Could not send to calendar')).toBeTruthy()
    expect(screen.getByText('Project not found')).toBeTruthy()
    expect(mockRefresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send to Calendar' })).toHaveProperty('disabled', false)
  })
})
