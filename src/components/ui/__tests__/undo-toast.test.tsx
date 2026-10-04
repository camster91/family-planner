/**
 * @jest-environment jsdom
 */
// One Undo at a time (O-42): a new Undo toast replaces the one showing, so
// quick actions never stack cards over the list. Other toasts still stack.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useToast, useUndoToast } from '../toast'

function Harness({ onUndo }: { onUndo: (n: number) => void }) {
  const showUndo = useUndoToast()
  const { addToast } = useToast()
  const count = React.useRef(0)
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const n = ++count.current
          showUndo({ title: `Action ${n}`, onUndo: () => onUndo(n) })
        }}
      >
        act
      </button>
      <button type="button" onClick={() => addToast({ type: 'error', title: 'Oops' })}>
        fail
      </button>
    </>
  )
}

describe('Undo toast', () => {
  it('shows only the newest Undo, and its Undo reverses the newest action', async () => {
    const onUndo = jest.fn()
    render(
      <ToastProvider>
        <Harness onUndo={onUndo} />
      </ToastProvider>
    )
    const act = screen.getByRole('button', { name: 'act' })
    await userEvent.click(act)
    await userEvent.click(act)
    await userEvent.click(act)
    const toasts = screen.getAllByTestId('undo-toast')
    expect(toasts).toHaveLength(1)
    expect(toasts[0].textContent).toContain('Action 3')

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(onUndo).toHaveBeenCalledWith(3)
    expect(screen.queryByTestId('undo-toast')).toBeNull()
  })

  it('leaves other toasts alone', async () => {
    render(
      <ToastProvider>
        <Harness onUndo={jest.fn()} />
      </ToastProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'fail' }))
    await userEvent.click(screen.getByRole('button', { name: 'act' }))
    await userEvent.click(screen.getByRole('button', { name: 'fail' }))
    await userEvent.click(screen.getByRole('button', { name: 'act' }))
    expect(screen.getAllByTestId('undo-toast')).toHaveLength(1)
    expect(screen.getAllByText('Oops')).toHaveLength(2)
  })
})
