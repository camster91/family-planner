/**
 * @jest-environment jsdom
 */
// Offline banner on pages outside the app shell (O-41).
import * as React from 'react'
import { act, render, screen } from '@testing-library/react'

let mockPath = '/login'
jest.mock('next/navigation', () => ({ usePathname: () => mockPath }))

import { SiteOfflineBanner, ownsBanner } from '../site-offline-banner'
import { OFFLINE_TEXT } from '../offline-banner'

let onLine = true
const onLineSpy = jest.spyOn(window.navigator, 'onLine', 'get')

function goOffline() {
  onLine = false
  act(() => {
    window.dispatchEvent(new Event('offline'))
  })
}

beforeEach(() => {
  onLine = true
  onLineSpy.mockImplementation(() => onLine)
})

describe('SiteOfflineBanner (O-41, pages outside the app shell)', () => {
  it.each(['/', '/login', '/register', '/join', '/forgot-password', '/privacy'])(
    'shows the offline banner on %s',
    (path) => {
      mockPath = path
      render(<SiteOfflineBanner />)
      goOffline()
      expect(screen.getByText(OFFLINE_TEXT)).toBeTruthy()
    }
  )

  it.each(['/dashboard', '/dashboard/chores', '/device', '/device/pair'])(
    'leaves %s to its own layout (no second banner)',
    (path) => {
      mockPath = path
      const { container } = render(<SiteOfflineBanner />)
      goOffline()
      expect(container.innerHTML).toBe('')
    }
  )

  it('matches whole path segments only', () => {
    expect(ownsBanner('/dashboard')).toBe(true)
    expect(ownsBanner('/devices-info')).toBe(false)
    expect(ownsBanner('/dashboardx')).toBe(false)
  })
})
