/**
 * Access gate for the design gallery (#156, docs/design/DESIGN_GALLERY.md).
 *
 * The gallery is a development and QA tool, not a product feature. It renders
 * only when the server is not a production build, or when the operator sets
 * the explicit opt-in `DESIGN_GALLERY_ENABLED=1` (the E2E server does, so the
 * production build CI tests can reach it). A production deployment never sets
 * it, so there the route answers 404 like any unknown path.
 *
 * Read at request time (the page is `force-dynamic`), never inlined at build.
 */
export const DESIGN_GALLERY_FLAG = 'DESIGN_GALLERY_ENABLED'

export function isDesignGalleryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NODE_ENV !== 'production') return true
  return env[DESIGN_GALLERY_FLAG] === '1'
}
