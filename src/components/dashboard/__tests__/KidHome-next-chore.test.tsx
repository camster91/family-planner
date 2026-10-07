/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import KidHome from '../KidHome'
import { ToastProvider } from '@/components/ui/toast'
import { FeaturesProvider } from '@/components/providers/features-provider'
import { defaultFeatures } from '@/lib/features'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

function day(offset: number): string {
  const now = new Date()
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00.000Z`
}

function chores(offset = 0, routine: string | null = null) {
  return Array.from({ length: 5 }, (_, i) => ({
    id: `chore-${i + 1}`, title: `Task ${i + 1}`, status: 'pending',
    due_date: day(offset), routine, routine_order: i + 1,
  }))
}

function renderHome(rows = chores(), workPreviewLimited = false) {
  return render(
    <FeaturesProvider initial={defaultFeatures()}>
      <ToastProvider>
        <KidHome user={{ name: 'Casey', role: 'child' }} chores={rows} events={[]} rewards={[]} workPreviewLimited={workPreviewLimited} />
      </ToastProvider>
    </FeaturesProvider>,
  )
}

const mission = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement
const response = (ok = true) => ({ ok, status: ok ? 200 : 409, json: async () => ({ error: 'Try again.' }) }) as Response

beforeAll(() => {
  window.HTMLMediaElement.prototype.play = jest.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = jest.fn()
})
beforeEach(() => {
  global.fetch = jest.fn(async () => response()) as unknown as typeof fetch
})

describe('KidHome next open chore', () => {
  it.each([
    ['today-missions', 0, null],
    ['earlier-missions', -1, null],
    ['routine-catchup-work', -1, 'Morning'],
  ] as const)('refills %s without a reload and keeps completed feedback', async (groupId, offset, routine) => {
    const { container } = renderHome(chores(offset, routine))
    const group = within(container.querySelector(`#${groupId}`) as HTMLElement)
    expect(group.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByText('Task 4')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show more (2)' })).toBeTruthy()

    await userEvent.click(mission('Task 1'))
    expect(await group.findByText('Task 4')).toBeTruthy()
    expect(mission('Task 1').disabled).toBe(true)
    expect(group.getAllByRole('button').filter((button) => !(button as HTMLButtonElement).disabled)).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show more (1)' })).toBeTruthy()

    await userEvent.click(mission('Task 2'))
    expect(await group.findByText('Task 5')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
    expect(group.getAllByRole('button')).toHaveLength(5)
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
  })

  it('Undo restores the three-open preview and hides the newly revealed fourth row', async () => {
    renderHome()
    await userEvent.click(mission('Task 1'))
    expect(await screen.findByText('Task 4')).toBeTruthy()
    await userEvent.click(within(screen.getByTestId('undo-toast')).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(mission('Task 1').disabled).toBe(false))
    expect(screen.queryByText('Task 4')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show more (2)' })).toBeTruthy()
    expect(global.fetch).toHaveBeenLastCalledWith('/api/chores/uncomplete', expect.objectContaining({ body: JSON.stringify({ choreId: 'chore-1' }) }))
  })

  it('a refused completion rolls the refill back instead of hiding unfinished work', async () => {
    let finish!: (value: Response) => void
    global.fetch = jest.fn(() => new Promise<Response>((resolve) => { finish = resolve })) as unknown as typeof fetch
    renderHome()
    await userEvent.click(mission('Task 1'))
    expect(await screen.findByText('Task 4')).toBeTruthy()
    await act(async () => finish(response(false)))
    expect(mission('Task 1').disabled).toBe(false)
    expect(screen.queryByText('Task 4')).toBeNull()
    expect(screen.getByText("Couldn't mark it done")).toBeTruthy()
  })

  it('Show more and Show less preserve the refill and expanded state semantics', async () => {
    renderHome()
    await userEvent.click(mission('Task 1'))
    await userEvent.click(screen.getByRole('button', { name: 'Show more (1)' }))
    expect(screen.getByText('Task 5')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.getByText('Task 4')).toBeTruthy()
    expect(screen.queryByText('Task 5')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show more (1)' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('celebrates only after all five loaded chores are ticked', async () => {
    renderHome()
    for (let i = 1; i <= 5; i++) {
      expect(screen.queryByTestId('kid-celebration')).toBeNull()
      await userEvent.click(mission(`Task ${i}`))
    }
    expect(await screen.findByTestId('kid-celebration')).toBeTruthy()
  })

  it('does not claim all done for a capped preview after every loaded row is ticked', async () => {
    renderHome(chores(), true)
    for (let i = 1; i <= 5; i++) await userEvent.click(mission(`Task ${i}`))
    expect(screen.queryByTestId('kid-celebration')).toBeNull()
    expect(screen.queryByText('All done for today!')).toBeNull()
    expect(screen.getByText(/Showing a limited set/)).toBeTruthy()
  })
})
