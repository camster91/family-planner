/** @jest-environment jsdom */
import { watchNativeApp } from '../native-app-lazy'
import { isNativeShell } from '../service-worker'

jest.mock('../service-worker', () => ({ isNativeShell: jest.fn() }))
jest.mock('../native-app', () => ({ watchNativeResume: jest.fn() }))

const nativeShell = jest.mocked(isNativeShell)
beforeEach(() => { nativeShell.mockReturnValue(false) })

it('leaves web connectivity and focus with the browser', async () => {
  const subscribe = jest.fn()
  const stop = watchNativeApp(subscribe)
  await Promise.resolve()
  expect(subscribe).not.toHaveBeenCalled()
  stop()
})

it('does not register a native subscriber after it unmounts', async () => {
  nativeShell.mockReturnValue(true)
  const subscribe = jest.fn()
  watchNativeApp(subscribe)()
  await Promise.resolve()
  await Promise.resolve()
  expect(subscribe).not.toHaveBeenCalled()
})

it('removes only the subscription it created', async () => {
  nativeShell.mockReturnValue(true)
  const unsubscribe = jest.fn()
  const subscribe = jest.fn(() => unsubscribe)
  const stop = watchNativeApp(subscribe)
  await Promise.resolve()
  await Promise.resolve()
  expect(subscribe).toHaveBeenCalledTimes(1)
  expect(unsubscribe).not.toHaveBeenCalled()
  stop()
  expect(unsubscribe).toHaveBeenCalledTimes(1)
})
