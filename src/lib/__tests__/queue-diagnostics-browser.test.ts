/** @jest-environment jsdom */
import { getPersonQueue, readPersonQueueDiagnostics } from '../offline-queue-browser'
import { createOfflineQueue } from '../offline-queue'

jest.mock('../offline-queue', () => ({
  ...jest.requireActual('../offline-queue'),
  createOfflineQueue: jest.fn(() => ({ ready: Promise.resolve(), diagnostics: jest.fn(() => ({ version: 1, depth: 7 })), subscribe: jest.fn(), drain: jest.fn(), handleOnline: jest.fn() })),
}))

it('does not create or drain an unloaded queue, and cannot read a device namespace', () => {
  expect(readPersonQueueDiagnostics('unloaded')).toBeNull()
  expect(readPersonQueueDiagnostics('device:tablet')).toBeNull()
  expect(createOfflineQueue).not.toHaveBeenCalled()
})

it('reads only the selected already-loaded person queue, with no new replay', () => {
  const queue = getPersonQueue('support-viewer')
  jest.mocked(queue.drain).mockClear()
  expect(readPersonQueueDiagnostics('support-viewer')).toEqual({ version: 1, depth: 7 })
  expect(readPersonQueueDiagnostics('another-viewer')).toBeNull()
  expect(queue.drain).not.toHaveBeenCalled()
  expect(createOfflineQueue).toHaveBeenCalledTimes(1)
})
