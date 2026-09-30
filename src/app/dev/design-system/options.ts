/**
 * URL options for the design gallery (#156). Everything that changes what the
 * gallery shows comes from the query string, so a URL fully describes a frame
 * and visual snapshots are deterministic:
 *
 *   /dev/design-system?theme=dark&long=1&data=empty&section=groceries
 */
export const GALLERY_THEMES = ['light', 'dark', 'fridge-night'] as const
export type GalleryTheme = (typeof GALLERY_THEMES)[number]

export const GALLERY_THEME_LABELS: Record<GalleryTheme, string> = {
  light: 'Light',
  dark: 'Dark',
  'fridge-night': 'Fridge night',
}

/** Stable section ids: the page anchors, `data-testid="gallery-section-<id>"` and `?section=<id>`. */
export const GALLERY_SECTIONS = [
  { id: 'foundations', title: 'Foundations' },
  { id: 'controls', title: 'Buttons and forms' },
  { id: 'overlays', title: 'Dialogs, sheets, menus and toasts' },
  { id: 'people', title: 'People and status' },
  { id: 'schedule', title: 'Schedule' },
  { id: 'meals', title: 'Meals and recipes' },
  { id: 'groceries', title: 'Groceries and lists' },
  { id: 'chores', title: 'Chores and routines' },
  { id: 'inventory', title: 'Inventory' },
  { id: 'states', title: 'Empty, loading, error, offline and sync' },
  { id: 'graphics', title: 'Original graphics' },
  { id: 'fridge', title: 'Fridge calm display and night' },
] as const

export type GallerySectionId = (typeof GALLERY_SECTIONS)[number]['id']

export interface GalleryOptions {
  theme: GalleryTheme
  /** Pseudolocalised, expanded fixture text (long-text and reflow checks). */
  long: boolean
  /** Empty fixture data: every data-driven component shows its empty state. */
  empty: boolean
  /** Render only this section, or all of them. */
  section: GallerySectionId | null
}

type RawParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export function parseGalleryOptions(params: RawParams): GalleryOptions {
  const theme = first(params.theme)
  const long = first(params.long)
  const data = first(params.data)
  const section = first(params.section)
  return {
    theme: (GALLERY_THEMES as readonly string[]).includes(theme ?? '') ? (theme as GalleryTheme) : 'light',
    long: long === '1' || long === 'true',
    empty: data === 'empty',
    section: GALLERY_SECTIONS.some((s) => s.id === section) ? (section as GallerySectionId) : null,
  }
}

/** URL for a set of options; defaults are left out so URLs stay short. */
export function galleryHref(options: GalleryOptions, hash?: string): string {
  const q = new URLSearchParams()
  if (options.theme !== 'light') q.set('theme', options.theme)
  if (options.long) q.set('long', '1')
  if (options.empty) q.set('data', 'empty')
  if (options.section) q.set('section', options.section)
  const qs = q.toString()
  return `/dev/design-system${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}
