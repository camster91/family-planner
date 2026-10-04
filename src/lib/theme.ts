/**
 * Theme preference (O-43): Light, Dark or Auto (follow the phone/computer).
 *
 * Saved per device in localStorage under THEME_STORAGE_KEY, only when someone
 * picks one in Settings. With nothing saved the theme is Auto, so a phone in
 * dark mode opens the app dark. A choice already saved (light, dark or auto)
 * is read as-is and never rewritten.
 */
export type ThemePreference = 'light' | 'dark' | 'auto'

export const THEME_STORAGE_KEY = 'familyPlanner_theme'
export const DEFAULT_THEME: ThemePreference = 'auto'

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'auto'
}

/** The saved choice, or Auto when there is none (or it is unreadable). */
export function parseThemePreference(saved: string | null | undefined): ThemePreference {
  return isThemePreference(saved) ? saved : DEFAULT_THEME
}

/** Whether `pref` means dark right now, given the device's dark-mode setting. */
export function resolveIsDark(pref: ThemePreference, systemDark: boolean): boolean {
  return pref === 'dark' || (pref === 'auto' && systemDark)
}

/** The saved preference on this device; Auto when none or storage is blocked. */
export function readThemePreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_THEME
  }
}

/** Save an explicit choice. Storage can be blocked; the choice then lasts this visit. */
export function writeThemePreference(pref: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, pref)
  } catch {
    // Not remembered, still applied.
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** Toggle the `dark` class on <html> for `pref`. */
export function applyThemePreference(pref: ThemePreference): void {
  document.documentElement.classList.toggle('dark', resolveIsDark(pref, systemPrefersDark()))
}

/**
 * Runs in <head> before first paint (root layout) so the page never flashes
 * the wrong theme before React hydrates. Same rules as above, kept tiny and
 * dependency-free; a test checks it against resolveIsDark.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=null;try{p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY
)})}catch(e){}if(p!=="light"&&p!=="dark")p="auto";var d=p==="dark"||(p==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`
