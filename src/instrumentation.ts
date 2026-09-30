/**
 * Runs once when a Next.js server instance starts.
 *
 * Production refuses to start without the variables sign-in needs, and warns
 * about the ones a real household will miss (src/lib/env-check.ts).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { assertProductionEnv } = await import('@/lib/env-check')
  assertProductionEnv()
}
