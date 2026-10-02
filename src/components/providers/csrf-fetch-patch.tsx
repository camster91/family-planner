'use client'

/**
 * Loads the global fetch patch that adds the CSRF header to state-changing
 * API requests (`src/lib/fetch-csrf.ts`).
 *
 * The root layout is a server component. A bare side-effect import of a
 * client module from it is not guaranteed to run in the browser (it never
 * runs under `next dev`), so every save would fail with "CSRF token
 * missing". Rendering this client component makes the browser load the
 * module on every page.
 */
import '@/lib/fetch-csrf'

export function CsrfFetchPatch() {
  return null
}
