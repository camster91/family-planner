/**
 * @jest-environment jsdom
 */
// "Add task" on an existing project (route inventory F-5, #289): the in-app
// caller of POST /api/projects/[id]/tasks.
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AddProjectTaskForm } from '../AddProjectTaskForm'
import { ToastProvider } from '@/components/ui/toast'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

type Call = { url: string; method: string; body: any }
let calls: Call[] = []
let reply: { status: number; body: unknown } | 'network' = { status: 201, body: {} }

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value })
}

beforeEach(() => {
  calls = []
  mockRefresh.mockClear()
  setOnline(true)
  reply = { status: 201, body: { task: { id: 't9', title: 'Paint fence' } } }
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

const members = [
  { id: 'u-parent', name: 'Pat' },
  { id: 'u-kid', name: 'Sam' },
]

function renderForm() {
  render(
    <ToastProvider>
      <AddProjectTaskForm projectId="proj 1" familyMembers={members} />
    </ToastProvider>
  )
}

async function openForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add task' }))
  return screen.getByRole('form', { name: 'Add task' })
}

it('starts as one 44px "Add task" button and opens a labelled form with focus in the title', async () => {
  const user = userEvent.setup()
  renderForm()
  const opener = screen.getByRole('button', { name: 'Add task' })
  expect(opener.className).toContain('min-h-[44px]')
  await openForm(user)

  const title = screen.getByLabelText('Task')
  expect(document.activeElement).toBe(title)
  expect(title.className).toContain('min-h-[44px]')
  expect(screen.getByLabelText(/Due date/).className).toContain('min-h-[44px]')
  const who = screen.getByLabelText(/Who's doing it/) as HTMLSelectElement
  expect(who.className).toContain('min-h-[44px]')
  expect(Array.from(who.options).map((o) => o.textContent)).toEqual(['Anyone', 'Pat', 'Sam'])
  for (const name of ['Add task', 'Done']) {
    const button = screen.getByRole('button', { name })
    expect(button.className).toContain('min-h-[44px]')
    expect(button.className).toContain('min-w-[44px]')
  }
})

it('posts the task to the project, clears the form, confirms and refreshes', async () => {
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  await user.type(screen.getByLabelText('Task'), '  Paint fence  ')
  await user.type(screen.getByLabelText(/Due date/), '2026-10-03')
  await user.selectOptions(screen.getByLabelText(/Who's doing it/), 'u-kid')
  await user.click(screen.getByRole('button', { name: 'Add task' }))

  await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
  expect(calls).toEqual([
    {
      url: '/api/projects/proj%201/tasks',
      method: 'POST',
      body: { title: 'Paint fence', due_date: '2026-10-03', assigned_to: 'u-kid' },
    },
  ])
  expect((screen.getByLabelText('Task') as HTMLInputElement).value).toBe('')
  expect(await screen.findByText('Task added')).toBeTruthy()
  expect(screen.queryByText(/Couldn't add the task/)).toBeNull()
})

it('sends only the title when nothing else is chosen', async () => {
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  await user.type(screen.getByLabelText('Task'), 'Buy paint')
  await user.click(screen.getByRole('button', { name: 'Add task' }))
  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].body).toEqual({ title: 'Buy paint' })
})

it('an empty title is not sent and says why', async () => {
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  await user.type(screen.getByLabelText('Task'), '   ')
  await user.click(screen.getByRole('button', { name: 'Add task' }))
  expect(screen.getByRole('alert').textContent).toBe('Give the task a name.')
  expect(screen.getByLabelText('Task').getAttribute('aria-invalid')).toBe('true')
  expect(calls).toHaveLength(0)
})

it("a refused save keeps what was typed and shows the server's reason", async () => {
  reply = { status: 400, body: { error: 'Cannot add tasks to a completed or archived project' } }
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  await user.type(screen.getByLabelText('Task'), 'Paint fence')
  await user.click(screen.getByRole('button', { name: 'Add task' }))

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe("Couldn't add the task. Cannot add tasks to a completed or archived project")
  expect((screen.getByLabelText('Task') as HTMLInputElement).value).toBe('Paint fence')
  expect(mockRefresh).not.toHaveBeenCalled()
})

it('a network failure keeps the text and asks to try again', async () => {
  reply = 'network'
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  await user.type(screen.getByLabelText('Task'), 'Paint fence')
  await user.click(screen.getByRole('button', { name: 'Add task' }))
  expect((await screen.findByRole('alert')).textContent).toContain("Couldn't add the task.")
  expect((screen.getByLabelText('Task') as HTMLInputElement).value).toBe('Paint fence')
})

it('offline: says so, disables the save and sends nothing', async () => {
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  act(() => {
    setOnline(false)
    window.dispatchEvent(new Event('offline'))
  })
  expect(screen.getByRole('status').textContent).toContain("You're offline")
  await user.type(screen.getByLabelText('Task'), 'Paint fence')
  const save = screen.getByRole('button', { name: 'Add task' }) as HTMLButtonElement
  expect(save.disabled).toBe(true)
  await user.type(screen.getByLabelText('Task'), '{Enter}')
  expect(calls).toHaveLength(0)

  act(() => {
    setOnline(true)
    window.dispatchEvent(new Event('online'))
  })
  expect(screen.queryByText(/You're offline/)).toBeNull()
  expect(save.disabled).toBe(false)
})

it('Done closes the form and returns focus to "Add task"', async () => {
  const user = userEvent.setup()
  renderForm()
  await openForm(user)
  await user.click(screen.getByRole('button', { name: 'Done' }))
  const opener = screen.getByRole('button', { name: 'Add task' })
  expect(screen.queryByRole('form')).toBeNull()
  await waitFor(() => expect(document.activeElement).toBe(opener))
})

it('without household members there is no assignee picker', async () => {
  const user = userEvent.setup()
  render(
    <ToastProvider>
      <AddProjectTaskForm projectId="p1" />
    </ToastProvider>
  )
  await openForm(user)
  expect(screen.queryByLabelText(/Who's doing it/)).toBeNull()
})
