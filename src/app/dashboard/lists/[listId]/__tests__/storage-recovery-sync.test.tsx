/** @jest-environment jsdom */
import { act, renderHook, waitFor } from '@testing-library/react'
import { createOfflineQueue } from '@/lib/offline-queue'
import { getPersonQueue } from '@/lib/person-queue-browser'
import { useListItemSync } from '../use-list-item-sync'

jest.mock('@/lib/person-queue-browser', () => ({ getPersonQueue: jest.fn() }))

it('changes from unread storage to compatible-client recovery without sending or rewriting future work', async () => {
  let blocked = true
  const raw = JSON.stringify({ v: 99, futureWork: ['retained'] })
  const write = jest.fn()
  const send = jest.fn()
  const queue = createOfflineQueue({
    store: { read: async () => { if (blocked) throw new Error('unread'); return raw }, write, remove: jest.fn() },
    send, now: () => 1000, random: () => 0, newKey: () => 'must-not-create-key',
    isOnline: () => true, setTimer: () => null, clearTimer: () => {},
  })
  jest.mocked(getPersonQueue).mockReturnValue(queue)
  const { result, unmount } = renderHook(() => useListItemSync('parent-a', jest.fn()))
  await waitFor(() => expect(result.current.storageBlocked).toBe(true))
  expect(result.current.notice).toBeNull()
  expect(result.current.storageBlocked).toBe(true)
  blocked = false
  await act(async () => { await queue.retryStorageRead() })
  expect(result.current.storageBlocked).toBe(false)
  expect(result.current.notice).toBe('compatible-client')
  expect(queue.requiresCompatibleClient()).toBe(true)
  expect(write).not.toHaveBeenCalled()
  expect(send).not.toHaveBeenCalled()
  unmount()
  queue.dispose()
})
