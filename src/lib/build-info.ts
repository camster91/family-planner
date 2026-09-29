/**
 * Build/release identity (#161, docs/architecture/OBSERVABILITY.md "Build
 * identity"). Served by `GET /api/version` so a support or test report can name
 * the exact server build.
 *
 * - `version`: `package.json` `version`, bundled at build time.
 * - `commit`: the `RELEASE_SHA` runtime variable. The release workflow passes it
 *   to `docker build` (`--build-arg RELEASE_SHA=${GITHUB_SHA}`), the Dockerfile
 *   bakes it into the image and the VPS deploy script sets it again on
 *   `docker run`. Anything that is not 7-40 hex characters reads as "unknown".
 * - `builtAt`: `FP_BUILT_AT`, which `next.config.js` inlines at `next build`
 *   time (the moment the bundle was compiled, not a runtime variable). Anything
 *   that is not an ISO timestamp reads as "unknown".
 *
 * Nothing else: no environment dump, hostname, database, feature or secret.
 */
import packageJson from '../../package.json'

export type BuildInfo = {
  version: string
  commit: string
  builtAt: string
}

const SHA_RE = /^[0-9a-f]{7,40}$/i
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,32})?$/
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export const UNKNOWN = 'unknown'

export function getBuildInfo(env: Record<string, string | undefined> = process.env): BuildInfo {
  const version = typeof packageJson.version === 'string' && VERSION_RE.test(packageJson.version) ? packageJson.version : UNKNOWN
  const sha = env.RELEASE_SHA?.trim()
  // Read FP_BUILT_AT directly so the build-time inline in next.config.js
  // replaces it; the `env` argument is for tests.
  const builtAtRaw = env === process.env ? process.env.FP_BUILT_AT : env.FP_BUILT_AT
  return {
    version,
    commit: sha && SHA_RE.test(sha) ? sha.toLowerCase() : UNKNOWN,
    builtAt: builtAtRaw && ISO_RE.test(builtAtRaw) ? builtAtRaw : UNKNOWN,
  }
}
