/**
 * Failed-password lockout shared by POST /api/auth/login and the tablet's
 * password elevation fallback.
 *
 * Two counters move on every wrong password for an address:
 *
 * - per account and client address (`login-fail-ip:`): the tight limit. One
 *   attacker guessing a parent's password from one network locks out only
 *   that network, so the parent can still sign in from their own.
 * - per account (`login-fail:`): a much higher ceiling that still caps a
 *   guesser spread across many addresses. Reaching it needs failures from at
 *   least ACCOUNT / SOURCE distinct addresses, not one stranger with a
 *   keyboard.
 *
 * Both are checked before the password is verified, so a locked counter never
 * reveals whether a guess was right.
 */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_SOURCE_FAILURE_LIMIT = 10
export const LOGIN_ACCOUNT_FAILURE_LIMIT = 50

export function loginAccountKey(email: string): string {
  return `login-fail:${email.toLowerCase()}`
}

export function loginSourceKey(email: string, ip: string): string {
  return `login-fail-ip:${ip}:${email.toLowerCase()}`
}
