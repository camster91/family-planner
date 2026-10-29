/**
 * Jest-only boundary for the Worker request-context package.
 *
 * @opennextjs/cloudflare is an ESM Worker runtime dependency. Loading it
 * through ts-jest's CommonJS test runner makes Node parse its ESM entrypoint
 * as CommonJS. Tests that need a context must provide an explicit
 * `jest.mock('@opennextjs/cloudflare', ...)`; the fail-closed default keeps a
 * test from accidentally depending on an ambient production context.
 */
module.exports = {
  getCloudflareContext() {
    throw new Error(
      "Cloudflare request context is unavailable in Jest; mock @opennextjs/cloudflare explicitly",
    );
  },
};
