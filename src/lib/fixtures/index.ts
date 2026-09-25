/**
 * Public entry point for deterministic dev/test fixtures (#154).
 *
 * API/E2E tests import ids, emails and the fake password from here, e.g.
 *   import { FIXTURE_IDS, FIXTURE_EMAILS, FIXTURE_PASSWORD } from '@/lib/fixtures'
 *
 * Seeding itself is done by `npm run fixtures:seed` (scripts/fixtures.mjs).
 * See docs/testing/TEST_DATA.md.
 */
export * from './dataset'
export * from './guard'
export { seedFixtures, resetFixtures, FixtureConflictError, isFixtureId } from './seed'
export type { PasswordHelpers, SeedSummary, ResetSummary } from './seed'
