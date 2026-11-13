/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ListItemTaskControl } from '../ListItemTaskControl'

jest.mock('@/i18n', () => ({
  useTranslation: () => ({
    locale: 'en',
    t: (key: string, params: Record<string, string> | undefined, catalogue: { en: Record<string, string> }) =>
      (catalogue.en[key] ?? key).replace(/\{(\w+)\}/g, (_: string, name: string) => params?.[name] ?? ''),
  }),
}))
const people = [
  { kind: 'account', id: 'u1', name: 'Avery', color: 'green' },
  { kind: 'profile', id: 'm1', name: 'Kid', color: 'sky' },
]
const server = (saveOk = true) => jest.fn(async (url: string, options?: RequestInit) => {
  if (options?.method === 'PATCH') {
    const sent = JSON.parse(String(options.body))
    return { ok: saveOk, json: async () => ({ task: { owner: people.find((p) => p.id === sent.owner?.id) ?? null, due: sent.due } }) }
  }
  return { ok: true, json: async () => ({ supported: true, people }) }
}) as unknown as typeof fetch
beforeAll(() => { jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'queueMicrotask', 'nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 0, 9, 12)) })
afterAll(() => { jest.useRealTimers() })

describe('ListItemTaskControl', () => {
  it('shows nothing to someone who cannot edit an item with no owner or due date, and asks the server nothing', () => {
    global.fetch = server()
    const { container } = render(<ListItemTaskControl itemId="i1" itemName="Rake leaves" canEdit={false} />)
    expect(container.innerHTML).toBe('')
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it.each([
    ['2026-01-08', 'overdue', 'Overdue · Thu, Jan 8'],
    ['2026-01-09', 'today', 'Due today'],
    ['2026-01-12', 'upcoming', 'Due Mon, Jan 12'],
  ])('shows the owner and a due day of %s as %s', (due, state, label) => {
    global.fetch = server()
    render(<ListItemTaskControl itemId="i1" itemName="Rake leaves" canEdit={false} initial={{ owner: { kind: 'account', id: 'u1', name: 'Avery', color: 'green' }, due }} />)
    expect(screen.getByTestId('list-item-task-owner').textContent).toBe('For Avery')
    const shown = screen.getByTestId('list-item-task-due')
    expect(shown.textContent).toBe(label)
    expect(shown.getAttribute('data-due-state')).toBe(state)
    expect(screen.queryByRole('button')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })
  it('loads the family only when opened, then saves the chosen owner and due day', async () => {
    global.fetch = server()
    render(<ListItemTaskControl itemId="i1" itemName="Rake leaves" canEdit />)
    expect(global.fetch).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Owner and due date for “Rake leaves”' }))
    const dialog = within(await screen.findByTestId('list-item-task-dialog'))
    await waitFor(() => expect((dialog.getByLabelText('Who is it for?') as HTMLSelectElement).options).toHaveLength(3))
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('/api/lists/people')
    fireEvent.change(dialog.getByLabelText('Who is it for?'), { target: { value: 'profile:m1' } })
    fireEvent.change(dialog.getByLabelText('Due date (optional)'), { target: { value: '2026-01-12' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByTestId('list-item-task-owner').textContent).toBe('For Kid'))
    const [url, options] = (global.fetch as jest.Mock).mock.calls[1]
    expect(url).toBe('/api/lists/items/task')
    expect(JSON.parse(options.body)).toEqual({ itemId: 'i1', owner: { kind: 'profile', id: 'm1' }, due: '2026-01-12' })
    expect(screen.getByTestId('list-item-task-due').textContent).toBe('Due Mon, Jan 12')
  })
  it('clears both with "Anyone" and an empty date', async () => {
    global.fetch = server()
    render(<ListItemTaskControl itemId="i1" itemName="Rake leaves" canEdit initial={{ owner: { kind: 'account', id: 'u1', name: 'Avery', color: 'green' }, due: '2026-01-12' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Owner and due date/ }))
    const dialog = within(await screen.findByTestId('list-item-task-dialog'))
    await waitFor(() => expect((dialog.getByLabelText('Who is it for?') as HTMLSelectElement).options).toHaveLength(3))
    expect((dialog.getByLabelText('Who is it for?') as HTMLSelectElement).value).toBe('account:u1')
    fireEvent.change(dialog.getByLabelText('Who is it for?'), { target: { value: '' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Clear' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByTestId('list-item-task-owner')).toBeNull())
    expect(JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)).toEqual({ itemId: 'i1', owner: null, due: null })
    expect(screen.queryByTestId('list-item-task-due')).toBeNull()
  })
  it('keeps the dialog open and says so when saving fails', async () => {
    global.fetch = server(false)
    render(<ListItemTaskControl itemId="i1" itemName="Rake leaves" canEdit />)
    fireEvent.click(screen.getByRole('button', { name: /Owner and due date/ }))
    const dialog = within(await screen.findByTestId('list-item-task-dialog'))
    await waitFor(() => expect((dialog.getByLabelText('Who is it for?') as HTMLSelectElement).options).toHaveLength(3))
    fireEvent.change(dialog.getByLabelText('Due date (optional)'), { target: { value: '2026-01-12' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }))
    expect((await dialog.findByRole('alert')).textContent).toBe('Could not save. Try again.')
    expect(screen.queryByTestId('list-item-task-due')).toBeNull()
  })
})
