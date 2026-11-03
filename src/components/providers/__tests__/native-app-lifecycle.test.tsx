/** @jest-environment jsdom */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { NativeAppLifecycle } from '../native-app-lifecycle'
import { watchNativeApp } from '@/lib/native-app-lazy'
jest.mock('@/lib/native-app-lazy', () => ({ watchNativeApp: jest.fn() }))

test('incoming links leave the current form intact until explicit opening and remove listeners', () => {
  let receive!: (target: string) => void
  const stopResume = jest.fn(), stopLinks = jest.fn()
  ;(watchNativeApp as jest.Mock).mockImplementation(subscribe => subscribe({
    watchNativeResume: () => stopResume,
    watchNativeNotificationLinks: (callback: typeof receive) => { receive = callback; return stopLinks },
  }))
  const { unmount } = render(<><input aria-label="Unsaved meal" defaultValue="Soup" /><NativeAppLifecycle /></>)
  expect(screen.queryByRole('link')).toBeNull()
  act(() => receive('/dashboard/calendar?focus=event-1'))
  expect(screen.getByRole('link', { name: 'Open reminder' })).toHaveAttribute('href', '/dashboard/calendar?focus=event-1')
  expect(screen.getByLabelText('Unsaved meal')).toHaveValue('Soup')
  act(() => receive('/dashboard/chores?focus=chore-1'))
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link')).toHaveAttribute('href', '/dashboard/chores?focus=chore-1')
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getByLabelText('Unsaved meal')).toHaveValue('Soup')
  unmount(); expect(stopResume).toHaveBeenCalledTimes(1); expect(stopLinks).toHaveBeenCalledTimes(1)
})
