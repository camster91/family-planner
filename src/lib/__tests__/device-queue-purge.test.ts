/**
 * @jest-environment jsdom
 */
// #274: the shared tablet's queue and the §8 purge. When the enveloped
// kill-switch 404 (or a revoke) purges the tablet while a queued tick is in
// flight, the queue must not write itself back afterwards: that would recreate
// the just-deleted device storage with the old household's ids.
import { getDeviceQueue } from '../offline-queue-browser'
import { createDeviceClient, DEVICE_QUEUE_KEY, DeviceApiError, type DeviceClient } from '../device-client'

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('device queue purge while a send is in flight', () => {
  it.each(['tick', 'add'])('drops the %s operation and leaves the purged storage empty', async (kind) => {
    // jsdom has no IndexedDB, so the queue uses the localStorage fallback under the reserved key.
    const listeners = new Set<(e: 'purge' | 'elevation') => void>()
    let requests = 0
    const client = {
      subscribe: (l: (e: 'purge' | 'elevation') => void) => {
        listeners.add(l)
        return () => listeners.delete(l)
      },
      request: jest.fn(async () => {
        requests++
        expect(window.localStorage.getItem(DEVICE_QUEUE_KEY)).not.toBeNull()
        // What the device client does on the kill-switch 404: wipe storage, emit
        // 'purge', then reject the original request.
        window.localStorage.removeItem(DEVICE_QUEUE_KEY)
        for (const l of Array.from(listeners)) l('purge')
        throw new DeviceApiError(404, 'NOT_FOUND', 'Not found.', { enveloped: true })
      }),
    } as unknown as DeviceClient

    const queue = getDeviceQueue(client)
    if (kind === 'add') await queue.enqueue('device.list-item.add', { listId: 'list-a', content: 'Queued grocery text', actingMemberId: 'm-1' })
    else await queue.enqueue('device.list-item.set-checked', { itemId: 'item-1', checked: true, actingMemberId: 'm-1' })
    await flush()

    expect(requests).toBe(1)
    expect(window.localStorage.getItem(DEVICE_QUEUE_KEY)).toBeNull()
    expect(queue.list()).toEqual([])
    // A new page-level queue after the purge starts empty.
    expect(getDeviceQueue(client)).not.toBe(queue)
  })

  it('forgets the cached queue when the same client completes a fresh pairing', async () => {
    window.localStorage.clear()
    const jsonResponse = (body: unknown) => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify(body),
    }) as unknown as Response
    const client = createDeviceClient({
      fetch: async (path) => {
        if (path === '/api/device/pair/claim')
          return jsonResponse({
            claimToken: 'pairing-claim-token',
            confirmDigits: '1234',
            expiresAt: '2026-01-05T12:10:00.000Z',
          })
        if (path === '/api/device/pair/status')
          return jsonResponse({ status: 'paired', device: { id: 'new-device', label: 'New tablet' } })
        return jsonResponse({})
      },
      now: () => 1_000_000,
      navigate: jest.fn(),
      csrfToken: () => null,
      isVisible: () => true,
      storages: () => [window.localStorage],
      deleteIndexedDb: async () => {},
      clearCaches: async () => {},
    })
    const wasOnline = navigator.onLine
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    try {
      const oldQueue = getDeviceQueue(client)
      await oldQueue.ready
      await oldQueue.enqueue('device.list-item.set-checked', {
        itemId: 'old-item',
        checked: true,
        actingMemberId: 'old-member',
      })
      await flush()
      expect(oldQueue.list()).toHaveLength(1)

      await client.claim('ABCD1234', 'web', 'web')
      await expect(client.pollPairing()).resolves.toMatchObject({ status: 'paired' })
      const freshQueue = getDeviceQueue(client)

      expect(freshQueue).not.toBe(oldQueue)
      await flush()
      expect(oldQueue.list()).toEqual([])
      expect(freshQueue.list()).toEqual([])
      expect(window.localStorage.getItem(DEVICE_QUEUE_KEY)).toBeNull()
    } finally {
      await client.purge()
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: wasOnline })
    }
  })
})
