/** @jest-environment jsdom */
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { Share } from '@capacitor/share'
import { canShareAppLink, shareAppLink, watchNativeConnection, watchNativeResume, watchNativeNotificationLinks } from '../native-app'

jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: jest.fn(), isPluginAvailable: jest.fn() } }))
jest.mock('@capacitor/app', () => ({ App: { addListener: jest.fn(), getLaunchUrl: jest.fn() } }))
jest.mock('@capacitor/network', () => ({ Network: { addListener: jest.fn(), getStatus: jest.fn() } }))
jest.mock('@capacitor/share', () => ({ Share: { share: jest.fn() } }))
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const native = () => { (Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true); (Capacitor.isPluginAvailable as jest.Mock).mockReturnValue(true) }
beforeEach(() => {
  jest.resetAllMocks()
  Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
  ;(App.addListener as jest.Mock).mockResolvedValue({ remove: jest.fn().mockResolvedValue(undefined) })
  ;(Network.addListener as jest.Mock).mockResolvedValue({ remove: jest.fn().mockResolvedValue(undefined) })
  ;(Network.getStatus as jest.Mock).mockResolvedValue({ connected: true })
})
test('web and older installed shells do not call absent native plugins', () => {
  const stop = watchNativeConnection(jest.fn()); const resume = watchNativeResume(jest.fn())
  stop(); resume()
  expect(Network.addListener).not.toHaveBeenCalled(); expect(App.addListener).not.toHaveBeenCalled()
  native(); (Capacitor.isPluginAvailable as jest.Mock).mockReturnValue(false)
  expect(canShareAppLink()).toBe(false)
})
test('sharing is explicit and native uses the existing URL', async () => {
  native(); expect(canShareAppLink()).toBe(true); expect(Share.share).not.toHaveBeenCalled()
  await shareAppLink('Sitter', 'https://family.ashbi.ca/handoff/test')
  expect(Share.share).toHaveBeenCalledWith({ title: 'Sitter', url: 'https://family.ashbi.ca/handoff/test', dialogTitle: 'Share link' })
})
test('web share stays inside the explicit call and preserves cancellation', async () => {
  const share = jest.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
  Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  expect(canShareAppLink()).toBe(true)
  await expect(shareAppLink('Sitter', 'https://family.ashbi.ca/handoff/test')).rejects.toMatchObject({ name: 'AbortError' })
  expect(Share.share).not.toHaveBeenCalled()
})
test.each(['javascript:alert(1)', 'http://family.ashbi.ca/a', 'https://user:pass@family.ashbi.ca/a'])('rejects unsafe link %s before invoking share', async url => {
  native(); await expect(shareAppLink('Sitter', url)).rejects.toThrow()
  expect(Share.share).not.toHaveBeenCalled()
})
test('late native listener registration is removed after unmount', async () => {
  native(); let finish!: (value: { remove: jest.Mock }) => void
  ;(App.addListener as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const callback = jest.fn(); const stop = watchNativeResume(callback); stop()
  const remove = jest.fn().mockResolvedValue(undefined); finish({ remove }); await settle()
  expect(remove).toHaveBeenCalledTimes(1)
  ;(App.addListener as jest.Mock).mock.calls[0][1]()
  expect(callback).not.toHaveBeenCalled()
})
test('network reads current state, emits changes, resamples on resume and removes its listeners', async () => {
  native(); const callback = jest.fn(); const stop = watchNativeConnection(callback); await settle()
  expect(callback).toHaveBeenLastCalledWith(true)
  ;(Network.addListener as jest.Mock).mock.calls[0][1]({ connected: false })
  expect(callback).toHaveBeenLastCalledWith(false)
  ;(Network.getStatus as jest.Mock).mockResolvedValue({ connected: false })
  ;(App.addListener as jest.Mock).mock.calls[0][1](); await settle()
  expect(Network.getStatus).toHaveBeenCalledTimes(2)
  const networkHandle = await (Network.addListener as jest.Mock).mock.results[0].value
  const appHandle = await (App.addListener as jest.Mock).mock.results[0].value
  stop(); expect(networkHandle.remove).toHaveBeenCalledTimes(1); expect(appHandle.remove).toHaveBeenCalledTimes(1)
  callback.mockClear(); (Network.addListener as jest.Mock).mock.calls[0][1]({ connected: true }); expect(callback).not.toHaveBeenCalled()
})
test('a delayed network sample cannot overwrite a newer connection event', async () => {
  native(); let finish!: (value: { connected: boolean }) => void
  ;(Network.getStatus as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const callback = jest.fn(); const stop = watchNativeConnection(callback); await settle()
  ;(Network.addListener as jest.Mock).mock.calls[0][1]({ connected: false }); finish({ connected: true }); await settle()
  expect(callback.mock.calls).toEqual([[false]]); stop()
})

test('native links handle cold and warm targets without forwarding an external URL', async () => {
  native(); (App.getLaunchUrl as jest.Mock).mockResolvedValue({ url: 'https://herewoven.com/dashboard/today' })
  const receive = jest.fn(); const stop = watchNativeNotificationLinks(receive); await settle()
  expect(receive).toHaveBeenLastCalledWith('/dashboard/today', 'launch')
  const open = (App.addListener as jest.Mock).mock.calls[0][1]
  open({ url: 'https://evil.test/dashboard/today' }); expect(receive).toHaveBeenCalledTimes(1)
  open({ url: 'https://herewoven.com/dashboard/chores?focus=chore-1' })
  expect(receive).toHaveBeenLastCalledWith('/dashboard/chores?focus=chore-1', 'open')
  stop(); open({ url: 'https://herewoven.com/dashboard/today' }); expect(receive).toHaveBeenCalledTimes(2)
})
test('a newer warm link wins over a delayed cold launch', async () => {
  native(); let finish!: (value: unknown) => void
  ;(App.getLaunchUrl as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const receive = jest.fn(); const stop = watchNativeNotificationLinks(receive); await settle()
  ;(App.addListener as jest.Mock).mock.calls[0][1]({ url: 'https://herewoven.com/dashboard/lists/list-1' })
  finish({ url: 'https://herewoven.com/dashboard/today' }); await settle()
  expect(receive).toHaveBeenCalledTimes(1)
  expect(receive).toHaveBeenCalledWith('/dashboard/lists/list-1', 'open'); stop()
})
test('late link registration removes its listener and never reads launch after retirement', async () => {
  native(); let finish!: (value: unknown) => void
  ;(App.addListener as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const receive = jest.fn(); const stop = watchNativeNotificationLinks(receive); stop()
  const remove = jest.fn().mockResolvedValue(undefined); finish({ remove }); await settle()
  expect(remove).toHaveBeenCalledTimes(1); expect(App.getLaunchUrl).not.toHaveBeenCalled()
  expect(receive).not.toHaveBeenCalled()
})
