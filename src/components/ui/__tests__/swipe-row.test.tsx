/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, render } from '@testing-library/react'
import { SwipeRow } from '../swipe-row'

function pointerEvent(element: Element, type: string, clientX: number) {
  const event = new Event(type, { bubbles: true })
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
  })
  fireEvent(element, event)
}

describe('SwipeRow', () => {
  it('uses the delete semantic tone for a left-swipe action', () => {
    const { container } = render(
      <SwipeRow onSwipeLeft={() => {}} swipeLeftTone="delete">
        <button type="button">Item</button>
      </SwipeRow>,
    )

    const deleteActions = container.querySelectorAll('.bg-danger-fill')
    expect(deleteActions).toHaveLength(2)
    expect(deleteActions[1].querySelector('svg.lucide-trash-2')).toBeTruthy()
    expect(deleteActions[1].querySelector('svg.lucide-check')).toBeNull()
  })

  it('invokes the left-swipe action after crossing its threshold', () => {
    const onSwipeLeft = jest.fn()
    const { container } = render(
      <SwipeRow onSwipeLeft={onSwipeLeft}>
        <button type="button">Item</button>
      </SwipeRow>,
    )
    const surface = Array.from(container.querySelectorAll<HTMLElement>('div')).find(
      (element) => element.style.touchAction === 'pan-y',
    )
    expect(surface).toBeTruthy()

    pointerEvent(surface!, 'pointerdown', 220)
    pointerEvent(surface!, 'pointermove', 20)
    pointerEvent(surface!, 'pointerup', 20)

    expect(onSwipeLeft).toHaveBeenCalledTimes(1)
  })

  it('does not invoke an action when the pointer is cancelled', () => {
    const onSwipeLeft = jest.fn()
    const { container } = render(
      <SwipeRow onSwipeLeft={onSwipeLeft}>
        <button type="button">Item</button>
      </SwipeRow>,
    )
    const surface = Array.from(container.querySelectorAll<HTMLElement>('div')).find(
      (element) => element.style.touchAction === 'pan-y',
    )
    expect(surface).toBeTruthy()

    pointerEvent(surface!, 'pointerdown', 220)
    pointerEvent(surface!, 'pointermove', 20)
    pointerEvent(surface!, 'pointercancel', 20)

    expect(onSwipeLeft).not.toHaveBeenCalled()
  })
})
