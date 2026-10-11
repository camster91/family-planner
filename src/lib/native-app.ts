import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { Share } from '@capacitor/share'

/** Old installed shells may not contain these plugins. Web remains usable. */
export function hasNativePlugin(name: string): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name)
}

export type NativeBuildIdentity = {
  platform: 'web' | 'android' | 'ios' | 'unknown'
  version: string | null
  build: string | null
}

/** Read installed shell identity without requesting permission or inventing a version. */
export async function readNativeBuildIdentity(): Promise<NativeBuildIdentity> {
  if (!Capacitor.isNativePlatform()) return { platform: 'web', version: null, build: null }
  const rawPlatform = Capacitor.getPlatform()
  const platform = rawPlatform === 'android' || rawPlatform === 'ios' ? rawPlatform : 'unknown'
  if (!hasNativePlugin('App')) return { platform, version: null, build: null }
  try {
    const info = await App.getInfo()
    const valid = (value: unknown) => typeof value === 'string' && /^[0-9][0-9A-Za-z.+-]{0,63}$/.test(value) ? value : null
    return { platform, version: valid(info.version), build: valid(info.build) }
  } catch { return { platform, version: null, build: null } }
}

/** Each subscriber owns only its own listener, including late registration. */
export function watchNativeConnection(onChange: (connected: boolean) => void): () => void {
  if (!hasNativePlugin('Network')) return () => undefined
  let stopped = false
  let handle: PluginListenerHandle | undefined
  let revision = 0
  const update = (connected: boolean) => { if (!stopped) onChange(connected) }
  const sample = async () => {
    const before = ++revision
    const status = await Network.getStatus()
    if (before === revision) update(status.connected)
  }
  const stopResume = watchNativeResume(() => { void sample().catch(() => undefined) })
  void Network.addListener('networkStatusChange', status => {
    revision += 1
    update(status.connected)
  }).then(async listener => {
    if (stopped) { await listener.remove(); return }
    handle = listener
    await sample()
  }).catch(() => undefined) // Browser indicators remain the fallback.
  return () => { stopped = true; stopResume(); void handle?.remove().catch(() => undefined) }
}

/** Foreground signals refresh existing readers without reloading/discarding forms. */
export function watchNativeResume(onResume: () => void): () => void {
  if (!hasNativePlugin('App')) return () => undefined
  let stopped = false
  let handle: PluginListenerHandle | undefined
  void App.addListener('resume', () => { if (!stopped) onResume() })
    .then(async listener => {
      if (stopped) await listener.remove()
      else handle = listener
    }).catch(() => undefined)
  return () => { stopped = true; void handle?.remove().catch(() => undefined) }
}

export function canShareAppLink(): boolean {
  return hasNativePlugin('Share') || (typeof navigator !== 'undefined' && typeof navigator.share === 'function')
}

/** Called only inside the user's Share tap; never forwards data automatically. */
export async function shareAppLink(title: string, url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid share link')
  if (hasNativePlugin('Share')) {
    await Share.share({ title, url, dialogTitle: 'Share link' })
    return
  }
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    await navigator.share({ title, url })
    return
  }
  throw new Error('Sharing is unavailable. Copy the link instead.')
}

export type NativeClientDetails = {
  platform: 'web' | 'android' | 'ios' | 'unknown'
  installed: 'not-native' | 'available' | 'unavailable'
  version: string
  build: string
  id: string
  plugins: { App: boolean; Network: boolean; Share: boolean }
}

/** Public binary metadata only, measured on a deliberate support action. */
export async function readNativeClientDetails(): Promise<NativeClientDetails> {
  const result: NativeClientDetails = {
    platform: 'web', installed: 'not-native', version: 'unknown', build: 'unknown', id: 'unknown',
    plugins: { App: false, Network: false, Share: false },
  }
  try {
    if (!Capacitor.isNativePlatform()) return result
    result.installed = 'unavailable'
    result.platform = 'unknown'
    const platform = Capacitor.getPlatform()
    result.platform = platform === 'android' || platform === 'ios' ? platform : 'unknown'
    for (const name of ['App', 'Network', 'Share'] as const) {
      result.plugins[name] = Capacitor.isPluginAvailable(name)
    }
    if (!result.plugins.App) return result
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const info = await Promise.race([
        App.getInfo(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Unavailable')), 3000) }),
      ])
      const publicValue = (value: unknown) => typeof value === 'string' && /^[a-zA-Z0-9._+-]{1,100}$/.test(value) ? value : 'unknown'
      result.version = publicValue(info.version)
      result.build = publicValue(info.build)
      result.id = publicValue(info.id)
      result.installed = 'available'
    } finally { if (timer) clearTimeout(timer) }
  } catch { /* Legacy bridges remain usable; never include raw errors. */ }
  return result
}
