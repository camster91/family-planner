/**
 * @jest-environment jsdom
 */
// #274: the shared tablet's queue and the §8 purge. When the enveloped
// kill-switch 404 (or a revoke) purges the tablet while a queued tick is in
// flight, the queue must not write itself back afterwards: that would recreate
// the just-deleted device storage with the old household's ids.
import { getDeviceQueue } from '../offline-queue-browser'
import { DEVICE_QUEUE_KEY, DeviceApiError, type DeviceClient } from '../device-client'

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
}

describe('device queue purge while a send is in flight', () => {
  it('drops the operation and leaves the purged storage empty', async () => {
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
    await queue.enqueue('device.list-item.set-checked', { itemId: 'item-1', checked: true, actingMemberId: 'm-1' })
    await flush()

    expect(requests).toBe(1)
    expect(window.localStorage.getItem(DEVICE_QUEUE_KEY)).toBeNull()
    expect(queue.list()).toEqual([])
    // A new page-level queue after the purge starts empty.
    expect(getDeviceQueue(client)).not.toBe(queue)
  })
})
