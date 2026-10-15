/** @jest-environment jsdom */
import { clearAllPersonQueues, getPersonQueue } from '../offline-queue-browser'
import { createOfflineQueue } from '../offline-queue'

jest.mock('../offline-queue', () => ({
  ...jest.requireActual('../offline-queue'),
  createOfflineQueue: jest.fn(),
}))

afterEach(() => jest.useRealTimers())

it('retires every personal queue before waiting on stuck storage, and still clears the namespace', async () => {
  jest.useFakeTimers()
  const makeQueue = () => ({
    ready: Promise.resolve(), subscribe: jest.fn(), drain: jest.fn(),
    handleOnline: jest.fn(), abandon: jest.fn(),
    clear: jest.fn(() => new Promise<void>(() => {})),
  })
  const first = makeQueue()
  const second = makeQueue()
  jest.mocked(createOfflineQueue)
    .mockReturnValueOnce(first as unknown as ReturnType<typeof createOfflineQueue>)
    .mockReturnValueOnce(second as unknown as ReturnType<typeof createOfflineQueue>)
  getPersonQueue('signout-a')
  getPersonQueue('signout-b')
  localStorage.setItem('fp-sync:v1:signout-a:queue', 'private queued bytes')
  localStorage.setItem('unrelated', 'keep')

  const cleared = clearAllPersonQueues()
  expect(first.abandon).toHaveBeenCalledTimes(1)
  expect(second.abandon).toHaveBeenCalledTimes(1)
  expect(first.clear).toHaveBeenCalledTimes(1)
  expect(second.clear).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem('fp-sync:v1:signout-a:queue')).toBeNull()
  expect(localStorage.getItem('unrelated')).toBe('keep')
  await jest.advanceTimersByTimeAsync(1000)
  await cleared

  const replacement = makeQueue()
  jest.mocked(createOfflineQueue).mockReturnValueOnce(replacement as unknown as ReturnType<typeof createOfflineQueue>)
  expect(getPersonQueue('signout-a')).toBe(replacement)
})
