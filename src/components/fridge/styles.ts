/**
 * Shared class strings for the Today board. Semantic tokens only
 * (src/app/globals.css); text colours are the WCAG-safe label/accent tokens.
 *
 * `2xl:` (>= 1400px) steps type and targets up for the 13"-class 16:10
 * fridge hub (1920x1200, #262), read from across the kitchen.
 */

const focusRing =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]'

/** Pill action link, at least 44x44 CSS px. Pressed state, never hover-only. */
export const actionLinkClass = [
  'inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-full px-5',
  'bg-accent-tint text-[15px] font-semibold text-accent md:text-[17px]',
  '2xl:min-h-[56px] 2xl:px-6 2xl:text-[19px]',
  'active:bg-accent-tint-strong',
  focusRing,
].join(' ')

/** Full-width row link (grocery items, overflow rows), at least 44px tall. */
export const rowLinkClass = [
  'flex min-h-[52px] w-full items-center gap-3 rounded-[var(--radius-md)] px-3 -mx-3 2xl:min-h-[60px]',
  'active:bg-[var(--surface-fill)]',
  focusRing,
].join(' ')

/**
 * Full-width tappable row that acts in place (#274: tick a grocery item or
 * mark a chore done). Same size as a row link, a pressed state, never hover-only.
 */
export const rowButtonClass = [
  'flex min-h-[52px] w-full items-center gap-3 rounded-[var(--radius-md)] px-3 -mx-3 text-left 2xl:min-h-[60px]',
  'active:bg-[var(--surface-fill)]',
  focusRing,
].join(' ')

/** A tile heading that opens its section (#274), at least 44px (56px on the hub). */
export const headerLinkClass = [
  'inline-flex min-h-[48px] max-w-full items-center gap-2 rounded-[var(--radius-md)] 2xl:min-h-[56px]',
  'active:text-accent',
  focusRing,
].join(' ')

export const regionClass = [
  'min-w-0 rounded-[var(--radius-xl)] border border-[var(--surface-separator)]',
  'bg-[var(--surface-elevated)] p-4 md:p-5 lg:p-5 2xl:p-7',
  focusRing,
].join(' ')

/** Region heading: readable from across the kitchen. */
export const regionTitleClass = 'text-[20px] font-semibold tracking-tight leading-tight text-label-primary md:text-[22px] lg:text-[24px] 2xl:text-[30px]'

/** Primary line inside a region (event title, grocery item, chore). */
export const itemTextClass = 'text-[17px] leading-snug text-label-primary md:text-[19px] lg:text-[20px] 2xl:text-[24px]'

/** Secondary line (times, counts, cook). */
export const metaTextClass = 'text-[14px] leading-snug text-label-secondary md:text-[16px] lg:text-[17px] 2xl:text-[20px]'

/** Calm empty-state copy. */
export const emptyTextClass = 'text-[16px] leading-relaxed text-label-secondary md:text-[18px] lg:text-[19px] 2xl:text-[24px]'
