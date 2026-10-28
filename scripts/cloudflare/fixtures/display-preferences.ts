import { readD1DisplayPreferences, updateD1DisplayPreferences, updateD1DisplayDefaults } from '../../../src/lib/cloudflare/display-preferences'
import { defaultPersonalLayout } from '../../../src/lib/personal-layout'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}
async function refuses(operation: () => unknown, code: string) {
  try { await operation() } catch (error) {
    check(error instanceof Error && 'code' in error && error.code === code, `expected ${code}`)
    return
  }
  throw new Error(`did not refuse ${code}`)
}
export async function testDisplayPreferences(db: D1Store) {
  const parent = { userId: 'read-a', familyId: 'read-family-a', tokenVersion: 0 }
  const child = { userId: 'read-b', familyId: 'read-family-a', tokenVersion: 0 }
  await db.prepare(`UPDATE "User" SET role = 'child' WHERE id = 'read-b'`).run()
  const initial = await readD1DisplayPreferences(parent, db)
  check(initial.revision === 0 && initial.defaultsRevision === 0 && initial.canManageDefaults, 'initial preferences')
  const race = await Promise.allSettled(Array.from({ length: 8 }, () => updateD1DisplayPreferences(parent, { expectedRevision: 0, quiet: true }, db)))
  check(race.filter(r => r.status === 'fulfilled').length === 1, 'one personal revision winner')
  check(race.filter(r => r.status === 'rejected' && r.reason.code === 'CONFLICT').length === 7, 'personal revision conflicts')
  check((await readD1DisplayPreferences(parent, db)).quiet, 'committed quiet mode')
  const today = { ...defaultPersonalLayout().today, density: 'compact' as const }
  const defaultsRace = await Promise.allSettled(Array.from({ length: 8 }, () => updateD1DisplayDefaults(parent, 0, today, db)))
  check(defaultsRace.filter(r => r.status === 'fulfilled').length === 1, 'one household defaults winner')
  check(defaultsRace.filter(r => r.status === 'rejected' && r.reason.code === 'CONFLICT').length === 7, 'household revision conflicts')
  const inherited = await readD1DisplayPreferences(child, db)
  check(inherited.layout.today.density === 'compact' && !inherited.canManageDefaults, 'child inherits defaults')
  await refuses(() => updateD1DisplayDefaults(child, 1, today, db), 'FORBIDDEN')
  const saved = await updateD1DisplayPreferences(child, { expectedRevision: 0, favorites: ['budget', 'wishlist'], today: { ...today, density: 'comfortable' } }, db)
  check(saved.layout.favorites.includes('wishlist') && !saved.layout.favorites.includes('budget') && saved.personalizedToday, 'role-safe personal overrides')
  const reset = await updateD1DisplayPreferences(child, { expectedRevision: 1, inheritToday: true }, db)
  check(!reset.personalizedToday && reset.layout.today.density === 'compact', 'restore household inheritance')
  await refuses(() => readD1DisplayPreferences({ ...parent, familyId: 'read-family-b' }, db), 'FORBIDDEN')
  await refuses(() => readD1DisplayPreferences({ ...parent, tokenVersion: 1 }, db), 'UNAUTHORIZED')
  await db.prepare(`INSERT INTO "User" (id,email,name) VALUES ('read-unattached','unattached@example.test','Fabricated unattached')`).run()
  try {
    const unattached = { userId: 'read-unattached', familyId: null, tokenVersion: 0 }
    check(!(await readD1DisplayPreferences(unattached, db)).canManageDefaults, 'no-household preferences')
    check((await updateD1DisplayPreferences(unattached, { expectedRevision: 0, quiet: true }, db)).revision === 1, 'no-household save')
  } finally { await db.prepare(`DELETE FROM "User" WHERE id = 'read-unattached'`).run() }
  // Change authority after the read and before the actual atomic write.
  function racingStore(sql: string): D1Store {
    return {
      prepare: db.prepare.bind(db), batch: db.batch.bind(db),
      withSession() {
        const primary = db.withSession('first-primary')
        return {
          prepare: primary.prepare.bind(primary),
          async batch(statements) { await db.prepare(sql).run(); return primary.batch(statements) },
        }
      },
    }
  }
  try {
    await refuses(() => updateD1DisplayDefaults(parent, 1, today, racingStore(`UPDATE "User" SET role='child' WHERE id='read-a'`)), 'FORBIDDEN')
    check((await db.prepare(`SELECT display_defaults_revision AS n FROM "Family" WHERE id='read-family-a'`).first<{ n: number }>())?.n === 1, 'demotion did not write defaults')
  } finally { await db.prepare(`UPDATE "User" SET role='parent' WHERE id='read-a'`).run() }
  try {
    await refuses(() => updateD1DisplayPreferences(parent, { expectedRevision: 1, quiet: false }, racingStore(`UPDATE "User" SET token_version=1 WHERE id='read-a'`)), 'UNAUTHORIZED')
    const row = await db.prepare(`SELECT display_preferences_revision AS n FROM "User" WHERE id='read-a'`).first<{ n: number }>()
    check(row?.n === 1, 'revoked session did not write preferences')
  } finally { await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='read-a'`).run() }
  try {
    await refuses(() => updateD1DisplayPreferences(parent, { expectedRevision: 1, quiet: false }, racingStore(`UPDATE "User" SET family_id='read-family-b' WHERE id='read-a'`)), 'FORBIDDEN')
    check((await db.prepare(`SELECT display_preferences_revision AS n FROM "User" WHERE id='read-a'`).first<{ n: number }>())?.n === 1, 'household change did not write preferences')
  } finally { await db.prepare(`UPDATE "User" SET family_id='read-family-a' WHERE id='read-a'`).run() }
  const failingStore: D1Store = {
    prepare: db.prepare.bind(db), batch: db.batch.bind(db),
    withSession() {
      const primary = db.withSession('first-primary')
      return {
        prepare: primary.prepare.bind(primary),
        batch: statements => primary.batch([...statements, primary.prepare('SELECT * FROM fixture_missing_table')]),
      }
    },
  }
  let failed = false
  try { await updateD1DisplayPreferences(parent, { expectedRevision: 1, quiet: false }, failingStore) }
  catch { failed = true }
  check(failed, 'injected storage failure')
  const afterFailure = await readD1DisplayPreferences(parent, db)
  check(afterFailure.revision === 1 && afterFailure.quiet, 'batch failure rolls back preference write')
  await db.prepare(`UPDATE "User" SET display_preferences='{"version":2}' WHERE id='read-c'`).run()
  try { await refuses(() => readD1DisplayPreferences({ userId: 'read-c', familyId: 'read-family-b', tokenVersion: 0 }, db), 'UNSUPPORTED') }
  finally { await db.prepare(`UPDATE "User" SET display_preferences=NULL WHERE id='read-c'`).run() }
  return { personalRace: 8, defaultsRace: 8, inheritance: true, childFavorites: true, householdScope: true, authorityRaces: true, rollback: true, noHousehold: true, unsupported: true }
}
