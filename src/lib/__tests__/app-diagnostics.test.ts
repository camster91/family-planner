import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { readNativeClientDetails } from '../native-app'
import { publicServerBuild, readAppDiagnostics } from '../app-diagnostics'
jest.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: jest.fn(), getPlatform: jest.fn(), isPluginAvailable: jest.fn() } }))
jest.mock('@capacitor/app', () => ({ App: { getInfo: jest.fn() } }))
jest.mock('@capacitor/network', () => ({ Network: {} }))
jest.mock('@capacitor/share', () => ({ Share: {} }))
const build = { version: '0.1.0', commit: 'abcdef0123456789', builtAt: '2026-10-10T19:00:00.000Z' }
const capabilities = { contract: 'herewoven.capabilities.v1', memberProtocols: [1], queueContainerVersion: 1, queueActions: [] }
beforeEach(() => { jest.resetAllMocks(); global.fetch = jest.fn(async url => ({ ok: true, json: async () => String(url) === '/api/capabilities' ? capabilities : build }) as Response) })
afterEach(() => jest.useRealTimers())
test('browser does not call the installed App bridge', async () => {
  const report = await readAppDiagnostics()
  expect(report.client.installed).toBe('not-native'); expect(App.getInfo).not.toHaveBeenCalled()
  expect(report.server).toEqual(build); expect(report.capabilities).toEqual(capabilities)
  expect(fetch).toHaveBeenCalledWith('/api/version', expect.objectContaining({ credentials: 'omit', cache: 'no-store' }))
})
test('installed identity is distinct from website identity and excludes extra fields', async () => {
  ;(Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true)
  ;(Capacitor.getPlatform as jest.Mock).mockReturnValue('android')
  ;(Capacitor.isPluginAvailable as jest.Mock).mockImplementation(name => name === 'App')
  ;(App.getInfo as jest.Mock).mockResolvedValue({ version: '1.2.3', build: '42', id: 'com.ashbi.familyplanner', name: 'PRIVATE_CANARY' })
  ;(fetch as jest.Mock).mockResolvedValue({ ok: true, json: async () => ({ ...build, token: 'PRIVATE_CANARY' }) })
  const report = await readAppDiagnostics()
  expect(report.client).toEqual({ platform: 'android', installed: 'available', version: '1.2.3', build: '42', id: 'com.ashbi.familyplanner', plugins: { App: true, Network: false, Share: false } })
  expect(report.server).toEqual(build); expect(JSON.stringify(report)).not.toContain('PRIVATE_CANARY')
})
test('old shell without App and old server 404 keep a usable partial report', async () => {
  ;(Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true)
  ;(Capacitor.getPlatform as jest.Mock).mockReturnValue('ios')
  ;(fetch as jest.Mock).mockResolvedValue({ ok: false })
  const report = await readAppDiagnostics()
  expect(report.client.installed).toBe('unavailable'); expect(report.server).toBeNull(); expect(App.getInfo).not.toHaveBeenCalled()
})
test('plugin and network failures never expose raw errors', async () => {
  ;(Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true)
  ;(Capacitor.getPlatform as jest.Mock).mockReturnValue('android')
  ;(Capacitor.isPluginAvailable as jest.Mock).mockReturnValue(true)
  ;(App.getInfo as jest.Mock).mockRejectedValue(new Error('PRIVATE_CANARY'))
  ;(fetch as jest.Mock).mockRejectedValue(new Error('PRIVATE_CANARY'))
  const report = await readAppDiagnostics()
  expect(report.client.installed).toBe('unavailable'); expect(report.server).toBeNull(); expect(JSON.stringify(report)).not.toContain('PRIVATE_CANARY')
})
test('a hung legacy bridge returns after a bounded wait', async () => {
  jest.useFakeTimers()
  try {
    ;(Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true)
    ;(Capacitor.getPlatform as jest.Mock).mockReturnValue('android')
    ;(Capacitor.isPluginAvailable as jest.Mock).mockReturnValue(true)
    ;(App.getInfo as jest.Mock).mockReturnValue(new Promise(() => {}))
    const pending = readNativeClientDetails()
    await jest.advanceTimersByTimeAsync(3000)
    expect((await pending).installed).toBe('unavailable')
  } finally { jest.useRealTimers() }
})
test.each([null, {}, { ...build, version: 'PRIVATE_CANARY' }, { ...build, commit: 'bad' }, { ...build, builtAt: 'yesterday' }])('rejects malformed server metadata %p', value => {
  expect(publicServerBuild(value)).toBeNull()
})

test('a broken legacy platform detector does not label a native install as a browser', async () => {
  ;(Capacitor.isNativePlatform as jest.Mock).mockReturnValue(true)
  ;(Capacitor.getPlatform as jest.Mock).mockImplementation(() => { throw new Error('Unavailable') })
  const details = await readNativeClientDetails()
  expect(details.platform).toBe('unknown'); expect(details.installed).toBe('unavailable')
})

test.each(['headers', 'body'])('ignored-abort public %s stalls settle without private/raw output', async phase => {
  jest.useFakeTimers();
  global.fetch = jest.fn(async () => phase === 'headers' ? new Promise<Response>(() => undefined)
    : { ok: true, json: () => new Promise(() => undefined) } as Response);
  const pending = readAppDiagnostics();
  await jest.advanceTimersByTimeAsync(3000);
  const report = await pending;
  expect(report.server).toBeNull(); expect(report.capabilities).toBeNull();
  expect(report.client.installed).toBe('not-native');
  expect(fetch).toHaveBeenCalledTimes(2);
});
test('bounds both public payloads before decoding declared oversized metadata', async () => {
  const json = jest.fn();
  global.fetch = jest.fn(async () => ({ ok: true, json, headers: new Headers({ 'content-length': '65536' }) }) as unknown as Response);
  const report = await readAppDiagnostics();
  expect(report.server).toBeNull(); expect(report.capabilities).toBeNull(); expect(json).not.toHaveBeenCalled();
});
test('does not start bridge/network work for an already closed panel', async () => {
  const controller = new AbortController(); controller.abort(); global.fetch = jest.fn();
  const report = await readAppDiagnostics({ signal: controller.signal });
  expect(fetch).not.toHaveBeenCalled(); expect(App.getInfo).not.toHaveBeenCalled();
  expect(report.server).toBeNull(); expect(report.capabilities).toBeNull();
});
