/**
 * Class strings for the shared-tablet screens and device settings (#241).
 * Semantic tokens only (src/app/globals.css), the same focus ring as the
 * Today board (src/components/fridge/styles.ts), every target >= 44x44.
 */

export const focusRing =
  'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]'

const base = [
  'inline-flex min-h-[48px] min-w-[48px] items-center justify-center gap-2 rounded-full px-5',
  'text-[17px] font-semibold disabled:cursor-not-allowed disabled:opacity-50',
  focusRing,
].join(' ')

/** Filled primary action (white on --accent-fill, 4.7:1+). */
export const primaryButtonClass = `${base} bg-accent-fill text-white active:bg-[var(--accent-fill-pressed)]`

/** Tinted secondary action, same look as the board's action links. */
export const secondaryButtonClass = `${base} bg-accent-tint text-accent active:bg-accent-tint-strong`

/** Neutral action on an elevated surface. */
export const neutralButtonClass = `${base} bg-[var(--surface-fill)] text-label-primary active:bg-[var(--surface-fill-secondary)]`

/** Destructive action (white on --danger-fill, 5.38:1). */
export const dangerButtonClass = `${base} bg-[var(--danger-fill)] text-white active:bg-[var(--danger-fill-pressed)]`

/** Text input, at least 48px tall. */
export const inputClass = [
  'block min-h-[48px] w-full rounded-[var(--radius-md)] border border-[var(--surface-separator)]',
  'bg-[var(--surface-elevated)] px-4 text-[17px] text-label-primary placeholder:text-label-tertiary',
  focusRing,
].join(' ')

export const labelClass = 'mb-2 block text-[15px] font-semibold text-label-primary'

/** Inline error text (role="alert" at the call site). */
export const errorTextClass =
  'rounded-[var(--radius-md)] bg-[var(--danger-tint)] px-4 py-3 text-[16px] leading-snug text-[var(--danger-text)]'

/** Calm neutral notice. */
export const noticeTextClass =
  'rounded-[var(--radius-md)] bg-[var(--surface-fill)] px-4 py-3 text-[16px] leading-snug text-label-primary'

/** Centered full-screen card for the tablet states (pair, removed, unavailable). */
export const screenCardClass = [
  'w-full max-w-xl rounded-[var(--radius-2xl)] border border-[var(--surface-separator)]',
  'bg-[var(--surface-elevated)] p-6 shadow-[var(--shadow-sm)] sm:p-10',
].join(' ')
