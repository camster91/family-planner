import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Network } from '@capacitor/network'
import { Share } from '@capacitor/share'

/** Old installed shells may not contain these plugins. Web remains usable. */
export function hasNativePlugin(name: string): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable(name)
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
