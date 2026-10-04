/**
 * @jest-environment jsdom
 */
// App-wide offline banner (O-41): hidden while online, "You're offline" on the
// `offline` event, "Back online." on `online` for a few seconds, then gone.
import * as React from 'react'
import '@testing-library/jest-dom'
import { act, render, screen } from '@testing-library/react'
import { BACK_ONLINE_MS, BACK_ONLINE_TEXT, OFFLINE_TEXT, OfflineBanner } from '../offline-banner'

let onLine = true
const onLineSpy = jest.spyOn(window.navigator, 'onLine', 'get')

function fire(type: 'online' | 'offline') {
  onLine = type === 'online'
  act(() => {
    window.dispatchEvent(new Event(type))
  })
}

beforeEach(() => {
  onLine = true
  onLineSpy.mockImplementation(() => onLine)
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

function liveRegion(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-offline-banner]') as HTMLElement
}

describe('OfflineBanner', () => {
  it('renders an empty polite live region while online', () => {
    const { container } = render(<OfflineBanner />)
    const region = liveRegion(container)
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).not.toHaveAttribute('role')
    expect(region.textContent).toBe('')
    expect(screen.queryByTestId('app-offline-banner')).toBeNull()
  })

  it('says it is offline on the offline event, and back online on the online event', () => {
    render(<OfflineBanner />)
    fire('offline')
    expect(screen.getByTestId('app-offline-banner')).toHaveTextContent(OFFLINE_TEXT)
    expect(screen.getByTestId('app-offline-banner')).toHaveAttribute('data-state', 'offline')

    fire('online')
    expect(screen.getByTestId('app-offline-banner')).toHaveTextContent(BACK_ONLINE_TEXT)

    act(() => {
      jest.advanceTimersByTime(BACK_ONLINE_MS - 1)
    })
    expect(screen.getByTestId('app-offline-banner')).toHaveTextContent(BACK_ONLINE_TEXT)
    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(screen.queryByTestId('app-offline-banner')).toBeNull()
  })

  it('shows at once when the page loads offline', () => {
    onLine = false
    render(<OfflineBanner />)
    expect(screen.getByTestId('app-offline-banner')).toHaveTextContent(OFFLINE_TEXT)
  })

  it('never says "Back online." without having been offline', () => {
    render(<OfflineBanner />)
    fire('online')
    expect(screen.queryByTestId('app-offline-banner')).toBeNull()
  })

  it('going offline again during "Back online." shows offline and keeps it', () => {
    render(<OfflineBanner />)
    fire('offline')
    fire('online')
    fire('offline')
    act(() => {
      jest.advanceTimersByTime(BACK_ONLINE_MS * 2)
    })
    expect(screen.getByTestId('app-offline-banner')).toHaveTextContent(OFFLINE_TEXT)
  })

  it('stops listening when unmounted', () => {
    const { unmount } = render(<OfflineBanner />)
    unmount()
    expect(() => fire('offline')).not.toThrow()
  })
})
