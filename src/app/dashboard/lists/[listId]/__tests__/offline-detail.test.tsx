/**
 * @jest-environment jsdom
 */
// One offline message per page (OFFLINE_SYNC.md): the app-wide OfflineBanner
// says "You're offline"; the list page only adds what it does offline (ticks
// queue on the device, #162) and how many are waiting.
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { SyncBanner, listOfflineDetail } from '../ListDetailClient'
import { SyncNotice } from '@/components/fridge/sync-status'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}))

const noop = () => {}

describe('list offline detail', () => {
  it('says what ticks do offline and how many are waiting, without repeating "offline"', () => {
    render(<SyncBanner online={false} durable pendingCount={3} notice={null} onDismiss={noop} />)
    const detail = screen.getByTestId('list-offline-detail')
    expect(detail.textContent).toBe(
      'You can still tick items. Ticks are saved on this device and sync when you reconnect. 3 waiting to sync.'
    )
    expect(detail.textContent).not.toMatch(/offline/i)
  })

  it('does not promise device storage when the queue is not durable', () => {
    expect(listOfflineDetail(false, 0)).toBe('You can still tick items. Ticks sync when you reconnect.')
  })

  it('shows nothing while online with nothing to report', () => {
    render(<SyncBanner online durable pendingCount={0} notice={null} onDismiss={noop} />)
    expect(screen.queryByTestId('list-offline-detail')).toBeNull()
  })
})

describe('calendar offline notice (app banner on screen)', () => {
  it('says only how old the month is', () => {
    const now = Date.now()
    render(<SyncNotice lastSyncAt={now - 2 * 60_000} now={now} online={false} what="calendar" canGoStale={false} appBanner />)
    expect(screen.getByTestId('sync-notice').textContent).toBe(
      'Showing what was here 2 min ago. The calendar refreshes when the connection returns.'
    )
  })
})
