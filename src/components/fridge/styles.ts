/**
 * Shared class strings for the Today board. Semantic tokens only
 * (src/app/globals.css); text colours are the WCAG-safe label/accent tokens.
 */

const focusRing =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]'

/** Pill action link, at least 44x44 CSS px. Pressed state, never hover-only. */
export const actionLinkClass = [
  'inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-full px-5',
  'bg-accent-tint text-[17px] font-semibold text-accent',
  'active:bg-accent-tint-strong',
  focusRing,
].join(' ')

/** Full-width row link (grocery items, overflow rows), at least 44px tall. */
export const rowLinkClass = [
  'flex min-h-[52px] w-full items-center gap-3 rounded-[var(--radius-md)] px-3 -mx-3',
  'active:bg-[var(--surface-fill)]',
  focusRing,
].join(' ')

export const regionClass = [
  'min-w-0 rounded-[var(--radius-xl)] border border-[var(--surface-separator)]',
  'bg-[var(--surface-elevated)] p-5 shadow-[var(--shadow-sm)] lg:p-6',
  focusRing,
].join(' ')

/** Region heading: readable from across the kitchen. */
export const regionTitleClass = 'text-[24px] font-bold leading-tight text-label-primary lg:text-[26px]'

/** Primary line inside a region (event title, grocery item, chore). */
export const itemTextClass = 'text-[19px] leading-snug text-label-primary md:text-[21px]'

/** Secondary line (times, counts, cook). */
export const metaTextClass = 'text-[16px] leading-snug text-label-secondary md:text-[18px]'

/** Calm empty-state copy. */
export const emptyTextClass = 'text-[19px] leading-snug text-label-secondary md:text-[21px]'
