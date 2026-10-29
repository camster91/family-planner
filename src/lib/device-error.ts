/**
 * Shared-device error protocol primitives.
 *
 * This module intentionally has no Next.js or request/runtime imports. Native
 * D1 domain effects use the plain envelope while HTTP routes wrap it in a
 * NextResponse through device-http.ts.
 */
export type DeviceErrorCode =
  | 'QUEUE_OWNER_CHANGED'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'PARENT_REQUIRED'
  | 'FAMILY_REQUIRED'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  | 'DEVICE_LIMIT_REACHED'
  | 'DEVICE_ACCESS_EXPIRED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_SESSION_INVALID'
  | 'DEVICE_MODE_LOGIN_BLOCKED'
  | 'DEVICE_WRITE_NOT_ALLOWED'
  | 'PAIRING_CODE_INVALID'
  | 'PAIRING_DIGITS_MISMATCH'
  | 'PAIRING_EXPIRED'
  | 'PAIRING_CANCELLED'
  | 'PAIRING_NOT_CLAIMED'
  | 'ELEVATION_INVALID_CREDENTIAL'
  | 'ELEVATION_LOCKED'
  | 'ELEVATION_REQUIRED'
  | 'ELEVATION_EXPIRED'
  | 'PIN_TOO_WEAK'
  | 'INVALID_PASSWORD'
  | 'DEVICE_WRITES_OFF'
  | 'FEATURE_DISABLED'
  | 'ACTING_MEMBER_INVALID'
  | 'CHORE_NOT_DUE_TODAY'
  | 'CHORE_ROUTINE_INACTIVE'
  | 'CHORE_ALREADY_VERIFIED'
  | 'UNDO_NOT_ALLOWED'
  | 'IDENTITY_CONFLICT'
  | 'MEMBER_PROTOCOL_UNAVAILABLE'
  | 'DUPLICATE_OPEN_ITEM'

export const DEVICE_ERROR_MESSAGES: Record<DeviceErrorCode, string> = {
  QUEUE_OWNER_CHANGED: 'Saved changes need a compatible session. Keep them and review recovery before retrying.',
  NOT_FOUND: 'Not found.',
  UNAUTHORIZED: 'Sign in to continue.',
  PARENT_REQUIRED: 'Only a parent can do this.',
  FAMILY_REQUIRED: 'Join or create a household first.',
  VALIDATION_ERROR: 'The request is not valid.',
  RATE_LIMITED: 'Too many attempts. Try again later.',
  SERVICE_UNAVAILABLE: 'Tablet mode is temporarily unavailable. Try again shortly.',
  INTERNAL_ERROR: 'Something went wrong.',
  DEVICE_LIMIT_REACHED: 'This household already has the maximum number of tablets.',
  DEVICE_ACCESS_EXPIRED: 'The tablet session needs refreshing.',
  DEVICE_REVOKED: 'This tablet was disconnected from its household.',
  DEVICE_SESSION_INVALID: 'This tablet is not connected to a household.',
  DEVICE_MODE_LOGIN_BLOCKED: 'This is a shared household tablet. Use the Parent button instead of signing in.',
  DEVICE_WRITE_NOT_ALLOWED: 'The shared household tablet cannot do this yet. Use your own phone.',
  PAIRING_CODE_INVALID: 'That code did not work. Check it and try again, or ask for a new code.',
  PAIRING_DIGITS_MISMATCH: 'That number does not match the tablet.',
  PAIRING_EXPIRED: 'This pairing has expired.',
  PAIRING_CANCELLED: 'This pairing was cancelled.',
  PAIRING_NOT_CLAIMED: 'The tablet has not entered the code yet.',
  ELEVATION_INVALID_CREDENTIAL: 'That did not work.',
  ELEVATION_LOCKED: 'Too many wrong attempts. Try again later or use your password.',
  ELEVATION_REQUIRED: 'A parent needs to confirm this.',
  ELEVATION_EXPIRED: 'Parent mode ended.',
  PIN_TOO_WEAK: 'Choose a 6-digit PIN that is harder to guess.',
  INVALID_PASSWORD: 'Current password is incorrect.',
  DEVICE_WRITES_OFF: 'Ticking things off on this tablet is turned off. A parent can turn it on in the board settings.',
  FEATURE_DISABLED: 'This part of the app is turned off for your household.',
  ACTING_MEMBER_INVALID: "Choose who's using the tablet.",
  CHORE_NOT_DUE_TODAY: 'Only chores due today can be ticked off on the tablet.',
  CHORE_ROUTINE_INACTIVE: 'This routine chore is no longer available. Refresh your chores.',
  CHORE_ALREADY_VERIFIED: 'A parent has already checked this chore, so it stays done.',
  UNDO_NOT_ALLOWED: 'This can only be undone on the tablet that did it, right after.',
  IDENTITY_CONFLICT: 'Household member identity needs review before this change.',
  MEMBER_PROTOCOL_UNAVAILABLE: 'This profile chore needs a newer tablet session.',
  DUPLICATE_OPEN_ITEM: 'This item is already on the list and not yet ticked.',
}

const RETRYABLE_DEVICE_ERRORS = new Set<DeviceErrorCode>([
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'DEVICE_ACCESS_EXPIRED',
])

export function deviceErrorBody(
  code: DeviceErrorCode,
  message?: string,
): { error: { code: DeviceErrorCode; message: string; retryable: boolean } } {
  return {
    error: {
      code,
      message: message ?? DEVICE_ERROR_MESSAGES[code],
      retryable: RETRYABLE_DEVICE_ERRORS.has(code),
    },
  }
}
