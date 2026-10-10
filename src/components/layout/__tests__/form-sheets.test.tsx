/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const back = jest.fn()
const push = jest.fn()
const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ back, push, refresh }), useSearchParams: () => new URLSearchParams() }))
jest.mock('@/components/providers/features-provider', () => ({ useFeatureEnabled: () => true }))
import { FormSheet, ListCreateSheet } from '../DashboardFormSheets'

beforeEach(() => { back.mockReset(); push.mockReset(); refresh.mockReset() })

it('returns through history, restores focus, scrolling and background interaction', async () => {
  const user = userEvent.setup()
  function Journey() {
    const [open, setOpen] = React.useState(false)
    back.mockImplementation(() => setOpen(false))
    return <><div data-dashboard-background><button onClick={() => setOpen(true)}>New list</button></div>{open && <FormSheet title="New List"><input aria-label="Draft" /></FormSheet>}</>
  }
  document.body.style.overflow = 'auto'
  const { container } = render(<Journey />)
  const opener = screen.getByRole('button', { name: 'New list' })
  await user.click(opener)
  const background = container.querySelector<HTMLElement>('[data-dashboard-background]')!
  expect(background.inert).toBe(true)
  expect(document.body.style.overflow).toBe('hidden')
  expect(screen.getByRole('dialog', { name: 'New List' })).toHaveAttribute('aria-modal', 'true')
  expect(screen.getByRole('button', { name: 'Close and return' })).toHaveFocus()
  await user.keyboard('{Escape}')
  expect(back).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(background.inert).toBe(false)
  expect(document.body.style.overflow).toBe('auto')
  expect(opener).toHaveFocus()
  document.body.style.overflow = ''
})

it('clears the actual list draft on close and fresh reopen without sending a mutation', async () => {
  const user = userEvent.setup()
  global.fetch = jest.fn()
  function Journey() {
    const [open, setOpen] = React.useState(false)
    back.mockImplementation(() => setOpen(false))
    return <><div data-dashboard-background><button onClick={() => setOpen(true)}>Add list</button></div>{open && <ListCreateSheet />}</>
  }
  render(<Journey />)
  await user.click(screen.getByRole('button', { name: 'Add list' }))
  await user.type(screen.getByLabelText('Name'), 'Packing draft')
  expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Close and return' }))
  await user.click(screen.getByRole('button', { name: 'Add list' }))
  expect(screen.getByLabelText('Name')).toHaveValue('')
  expect(fetch).not.toHaveBeenCalled()
})

it('does not dismiss the actual list sheet during save, then permits retry and close after failure', async () => {
  const user = userEvent.setup()
  let finish!: (r: Response) => void
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  render(<ListCreateSheet />)
  await user.type(screen.getByLabelText('Name'), 'Camping')
  await user.click(screen.getByRole('button', { name: /Create List/ }))
  expect(screen.queryByRole('button', { name: 'Close and return' })).not.toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(back).not.toHaveBeenCalled()
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Try again' }) } as Response))
  expect(screen.getByRole('alert')).toHaveTextContent('Try again')
  await user.click(screen.getByRole('button', { name: 'Close and return' }))
  expect(back).toHaveBeenCalledTimes(1)
})

it('does not dismiss during an image upload and unlocks after upload failure', async () => {
  const user = userEvent.setup()
  let finish!: (r: Response) => void
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { finish = resolve }))
  const { container } = render(<ListCreateSheet />)
  await user.click(container.querySelector('summary')!)
  await user.upload(screen.getByLabelText('Choose list image'), new File(['fixture'], 'cover.jpg', { type: 'image/jpeg' }))
  await user.keyboard('{Escape}')
  expect(back).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'Close and return' })).not.toBeInTheDocument()
  await act(async () => finish({ ok: false, json: async () => ({ error: 'Upload failed' }) } as Response))
  expect(screen.getByRole('button', { name: 'Close and return' })).toBeInTheDocument()
})

it('retains a pre-existing inert background and scroll lock on external unmount', () => {
  const background = document.createElement('div')
  background.setAttribute('data-dashboard-background', '')
  background.inert = true
  document.body.appendChild(background)
  document.body.style.overflow = 'hidden'
  const view = render(<FormSheet title="New Chore" busy><button>Saving</button></FormSheet>)
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(back).not.toHaveBeenCalled()
  view.unmount()
  expect(background.inert).toBe(true)
  expect(document.body.style.overflow).toBe('hidden')
  background.remove()
  document.body.style.overflow = ''
})
