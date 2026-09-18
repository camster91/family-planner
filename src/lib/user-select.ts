/**
 * The only user columns safe to send to a client.
 *
 * `password`, `reset_token`, `reset_token_expires`, `verify_token`,
 * `verify_token_expires` and `token_version` are deliberately absent: the two
 * token pairs are credentials, and `token_version` is server-side session state.
 *
 * Use this instead of fetching a whole User row and stripping fields — that
 * pattern is what leaked live reset/verify tokens to the browser.
 */
export const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  age: true,
  family_id: true,
  avatar_url: true,
  email_verified: true,
  xp: true,
  level: true,
  streak: true,
  best_streak: true,
  last_chore_date: true,
  created_at: true,
} as const
