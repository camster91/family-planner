// Beta support contact (#146).
//
// The support address is not decided yet. It is the `<SUPPORT_EMAIL>`
// placeholder in docs/product/BETA_OPERATIONS.md and docs/LAUNCH_CHECKLIST.md
// (item 5). When the owner picks one, set it here and nowhere else; the Help
// page (/dashboard/help) reads it. While it is empty, the page shows
// SUPPORT_EMAIL_PENDING_TEXT instead of an address. Do not put a made-up
// address here.
export const SUPPORT_EMAIL: string = ''

export const SUPPORT_EMAIL_PENDING_TEXT = 'Support email coming soon'

/** The support address, or null while it is not set. */
export function supportEmail(value: string = SUPPORT_EMAIL): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}
