/**
 * The shared tablet's queue sender (#274): queued grocery ticks go through the
 * device client, so its refresh/purge rules apply, and every outcome maps to
 * the status the queue classifies.
 */
import { deviceQueueSend } from '../offline-queue-browser'
import { DeviceApiError, type DeviceClient } from '../device-client'

function client(impl: (path: string, options: any) => Promise<unknown>) {
  const request = jest.fn(impl)
  return { client: { request } as unknown as DeviceClient, request }
}

const req = {
  method: 'PATCH',
  path: '/api/device/lists/items/item-1',
  body: { checked: true, actingMemberId: 'm' },
  idempotencyKey: 'key-0001-abcdefghijkl',
}

describe('deviceQueueSend', () => {
  it('sends through the device client with the Idempotency-Key and reports success', async () => {
    const { client: c, request } = client(async () => ({ item: { id: 'item-1', checked: true } }))
    await expect(deviceQueueSend(c)(req)).resolves.toEqual({ status: 200, body: { item: { id: 'item-1', checked: true } } })
    expect(request).toHaveBeenCalledWith('/api/device/lists/items/item-1', {
      method: 'PATCH',
      body: { checked: true, actingMemberId: 'm' },
      headers: { 'Idempotency-Key': 'key-0001-abcdefghijkl' },
    })
  })

  it('turns an HTTP error into its status and code, and rejects on a network failure', async () => {
    const refused = client(async () => {
      throw new DeviceApiError(403, 'DEVICE_WRITES_OFF', 'off')
    })
    await expect(deviceQueueSend(refused.client)(req)).resolves.toEqual({
      status: 403,
      body: { error: { code: 'DEVICE_WRITES_OFF' } },
    })
    const offline = client(async () => {
      throw new DeviceApiError(0, 'NETWORK_ERROR', 'offline', { retryable: true })
    })
    await expect(deviceQueueSend(offline.client)(req)).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })
})
