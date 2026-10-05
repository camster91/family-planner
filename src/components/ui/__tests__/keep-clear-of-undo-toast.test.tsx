/**
 * @jest-environment jsdom
 */
// useKeepClearOfUndoToast: on a short page whose end sits under the Undo card
// (kid home's Rewards card), the page reserves the card's room while it shows
// and scrolls just far enough to lift its end clear. Long pages, side-by-side
// layouts and pages that do not opt in are left alone.
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider, useKeepClearOfUndoToast, useUndoToast } from '../toast'

function Page() {
  const showUndo = useUndoToast()
  const end = React.useRef<HTMLDivElement>(null)
  const room = useKeepClearOfUndoToast(end)
  return (
    <div>
      <div ref={end} data-testid="end">
        <button type="button" onClick={() => showUndo({ title: 'Done', onUndo: () => undefined })}>
          act
        </button>
      </div>
      <output data-testid="room">{room}</output>
    </div>
  )
}

type Box = { top: number; bottom: number; left?: number; right?: number }
function setBox(el: Element, b: Box) {
  const left = b.left ?? 16
  const right = b.right ?? 374
  jest.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: b.top,
    bottom: b.bottom,
    left,
    right,
    height: b.bottom - b.top,
    width: right - left,
    x: left,
    y: b.top,
    toJSON: () => ({}),
  } as DOMRect)
}

let frames: FrameRequestCallback[] = []
let scrollTo: jest.Mock

beforeEach(() => {
  frames = []
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb)
    return frames.length
  })
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  scrollTo = jest.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 40 })
})
afterEach(() => jest.restoreAllMocks())

async function showUndoWith(end: Box, stack: Box) {
  render(
    <ToastProvider>
      <Page />
    </ToastProvider>
  )
  expect(screen.getByTestId('room').textContent).toBe('0')
  await userEvent.click(screen.getByRole('button', { name: 'act' }))
  const stackEl = screen.getByTestId('undo-toast').parentElement as HTMLElement
  setBox(screen.getByTestId('end'), end)
  setBox(stackEl, stack)
  act(() => {
    frames.splice(0).forEach((cb) => cb(0))
  })
}

describe('useKeepClearOfUndoToast', () => {
  it('reserves room while an Undo shows and lifts a covered end clear of it', async () => {
    // Toast stack 686..748 (above the tab bar); the page ends at 700.
    await showUndoWith({ top: 620, bottom: 700 }, { top: 686, bottom: 748 })
    // jsdom has no layout, so the stack's height reads 0: room is the gap.
    expect(Number(screen.getByTestId('room').textContent)).toBeGreaterThan(0)
    // 700 - (686 - 12) = 26 more, from scrollY 40.
    expect(scrollTo).toHaveBeenCalledWith({ top: 66, behavior: 'smooth' })
  })

  it('does nothing when the end already clears the card', async () => {
    await showUndoWith({ top: 500, bottom: 660 }, { top: 686, bottom: 748 })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves a long page alone while its end is still below the screen', async () => {
    await showUndoWith({ top: 700, bottom: 1200 }, { top: 686, bottom: 748 })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('leaves the page alone when the toast sits beside it (md+ corner)', async () => {
    await showUndoWith({ top: 620, bottom: 700, left: 100, right: 600 }, { top: 686, bottom: 748, left: 620, right: 1000 })
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('drops the room when the Undo goes away', async () => {
    await showUndoWith({ top: 620, bottom: 700 }, { top: 686, bottom: 748 })
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.getByTestId('room').textContent).toBe('0')
  })
})
