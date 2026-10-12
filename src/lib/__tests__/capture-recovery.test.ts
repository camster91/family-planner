import {
  activateCaptureRecoveryStorage,
  captureRecoveryStorageKey,
  clearCaptureRecoveryStorage,
  hashCaptureRequest,
  loadCaptureRecovery,
  loadCaptureRecoveryState,
  saveCaptureRecovery,
  type CaptureRecoveryEnvelope,
} from '../capture-recovery'

function row(overrides: Partial<CaptureRecoveryEnvelope> = {}): CaptureRecoveryEnvelope {
  return {
    version: 1,
    key: 'capture-key-12345678',
    action: 'event.create',
    requestHash: 'a'.repeat(64),
    body: JSON.stringify({ title: 'Dentist', start_time: '2026-10-06T19:00:00.000Z', event_type: 'other' }),
    title: 'Dentist',
    kind: 'event',
    createdAt: 1_000,
    photo: false,
    ...overrides,
  }
}

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  }
}

describe('capture recovery envelopes', () => {
  it('keeps a household namespace, drops expired/corrupt rows and bounds retention', () => {
    const store = storage()
    const key = captureRecoveryStorageKey('user-a', 'family-a')
    saveCaptureRecovery(store, 'user-a', 'family-a', [row(), row({ key: 'capture-key-expired', createdAt: 0 }), { nope: true } as never])

    expect(loadCaptureRecovery(store, 'user-a', 'family-a', 1_000 + 6 * 24 * 60 * 60 * 1000)).toEqual([])
    expect(store.values.get(key)).toBe('[]')

    saveCaptureRecovery(store, 'user-a', 'family-a', [row()])
    expect(loadCaptureRecovery(store, 'other-user', 'family-a', 1_000)).toEqual([])
  })

  it('removes the previous account namespace when a new session becomes active', () => {
    const store = storage()
    const first = captureRecoveryStorageKey('user-a', 'family-a')
    const second = captureRecoveryStorageKey('user-b', 'family-b')
    saveCaptureRecovery(store, 'user-a', 'family-a', [row()])
    expect(activateCaptureRecoveryStorage(store, 'user-a', 'family-a')).toBe(first)
    expect(activateCaptureRecoveryStorage(store, 'user-b', 'family-b')).toBe(second)
    expect(store.values.has(first)).toBe(false)
  })

  it('matches the server canonical hash regardless of object key order', async () => {
    await expect(hashCaptureRequest('event.create', { title: 'Dentist', event_type: 'other' })).resolves.toHaveLength(64)
    await expect(hashCaptureRequest('event.create', { event_type: 'other', title: 'Dentist' })).resolves.toBe(
      await hashCaptureRequest('event.create', { title: 'Dentist', event_type: 'other' }),
    )
  })

  it('purges the active namespace and marker at logout', () => {
    const store = storage()
    const key = captureRecoveryStorageKey('user-a', 'family-a')
    saveCaptureRecovery(store, 'user-a', 'family-a', [row()])
    activateCaptureRecoveryStorage(store, 'user-a', 'family-a')

    clearCaptureRecoveryStorage(store)

    expect(store.values.has(key)).toBe(false)
    expect(store.values.has('family-planner:capture-recovery:v1:active')).toBe(false)
  })

  it('purges an explicit namespace even when no active marker exists', () => {
    const store = storage()
    const key = captureRecoveryStorageKey('user-a', 'family-a')
    saveCaptureRecovery(store, 'user-a', 'family-a', [row()])

    clearCaptureRecoveryStorage(store, 'user-a', 'family-a')

    expect(store.values.has(key)).toBe(false)
  })

  it('reports activation, read, write and purge storage failures', () => {
    const unavailable = {
      getItem: () => { throw new Error('private mode') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('private mode') },
    }

    expect(activateCaptureRecoveryStorage(unavailable, 'user-a', 'family-a')).toBeNull()
    expect(saveCaptureRecovery(unavailable, 'user-a', 'family-a', [row()])).toBe(false)
    expect(loadCaptureRecoveryState(unavailable, 'user-a', 'family-a')).toEqual({ rows: [], storageAvailable: false })
    expect(clearCaptureRecoveryStorage(unavailable, 'user-a', 'family-a')).toBe(false)
  })
})
