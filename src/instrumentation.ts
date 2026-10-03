/**
 * Runs once when a Next.js server instance starts.
 *
 * Production refuses to start without the variables sign-in needs, and warns
 * about the ones a real household will miss (src/lib/env-check.ts).
 *
 * The import sits inside the NEXT_RUNTIME check (not after an early return) so
 * webpack drops it from the edge bundle: env-check reaches Node-only modules
 * such as `crypto` through the calendar sync config.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionEnv } = await import('@/lib/env-check')
    assertProductionEnv()
  }
}
