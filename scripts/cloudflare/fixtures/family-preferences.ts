import { readD1AiSettings, updateD1AiSettings, readD1FeedToken, ensureD1FeedToken, readD1Travel, updateD1Travel, readD1SettingsSeed } from '../../../src/lib/cloudflare/family-preferences'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refuses(operation: () => unknown, status: number) {
  try { await operation() } catch (error) { check(error instanceof Error && 'status' in error && error.status === status, `expected ${status}`); return }
  throw new Error(`did not refuse ${status}`)
}
export async function testFamilyPreferences(db: D1Store) {
  const actor = { userId: 'read-a', familyId: 'read-family-a', generation: 0 }
  const child = { ...actor, userId: 'read-b' }
  const other = { userId: 'read-c', familyId: 'read-family-b', generation: 0 }
  const tokens = await Promise.all(Array.from({ length: 8 }, () => ensureD1FeedToken(actor, false, db)))
  check(new Set(tokens.map(t => t.feedToken)).size === 1 && /^[a-f0-9]{48}$/.test(tokens[0].feedToken!), 'one concurrent feed identity')
  const rotated = await ensureD1FeedToken(actor, true, db)
  check(rotated.regenerated === true && rotated.feedToken !== tokens[0].feedToken && (await readD1FeedToken(actor, db)).feedToken === rotated.feedToken, 'feed rotation retires old identity')
  check((await readD1FeedToken(other, db)).feedToken === null, 'other feed private')
  await db.prepare(`UPDATE "Family" SET feed_token='' WHERE id='read-family-b'`).run()
  check(/^[a-f0-9]{48}$/.test((await ensureD1FeedToken(other, false, db)).feedToken!), 'legacy empty feed identity is replaced')
  await refuses(() => readD1FeedToken(child, db), 403)
  const ai = await updateD1AiSettings(actor, { capture_ai_key_enc: 'fixture-opaque-ciphertext', capture_ai_base_url: 'https://example.test/api', capture_ai_model: 'fixture-model' }, db)
  check((await readD1SettingsSeed(actor, false, db))?.aiKeyStored === true, 'parent Settings uses key-presence flag')
  check((await readD1SettingsSeed(child, true, db))?.betaMetrics === null && (await readD1SettingsSeed(child, true, db))?.aiKeyStored === false && (await readD1SettingsSeed(child, true, db))?.sharedDevice === null, 'child Settings seed excludes household data')
  check(await readD1SettingsSeed({ ...actor, generation: 1 }, true, db) === null, 'revoked Settings seed')
  check(ai.capture_ai_key_enc === 'fixture-opaque-ciphertext' && !('feed_token' in ai), 'AI server projection')
  await updateD1AiSettings(actor, { capture_ai_model: 'fixture-model-two' }, db)
  check((await readD1AiSettings(actor, db)).capture_ai_key_enc === 'fixture-opaque-ciphertext', 'omitted AI key preserved')
  check((await readD1AiSettings(other, db)).capture_ai_key_enc === null, 'AI household isolation')
  await refuses(() => readD1AiSettings(child, db), 403)
  await updateD1AiSettings(actor, { capture_ai_key_enc: null, capture_ai_base_url: null, capture_ai_model: null }, db)
  check((await readD1AiSettings(actor, db)).capture_ai_key_enc === null, 'AI key clear')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.travel',json('false')) WHERE id='read-family-a'`).run()
  await refuses(() => readD1Travel(actor, db), 403)
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.travel',1) WHERE id='read-family-a'`).run()
  await refuses(() => updateD1Travel(actor, { travel_destination: 'Must not save' }, db), 403)
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.travel',json('true')) WHERE id='read-family-a'`).run()
  await Promise.all([
    updateD1Travel(actor, { travel_mode_active: true }, db),
    updateD1Travel(actor, { travel_start_date: new Date('2026-10-28T00:00:00Z') }, db),
    updateD1Travel(actor, { travel_end_date: new Date('2026-11-01T00:00:00Z') }, db),
    updateD1Travel(actor, { travel_destination: 'Fabricated trip' }, db),
  ])
  const saved = await readD1Travel(actor, db)
  check(saved.travel_mode_active && saved.travel_start_date?.toISOString() === '2026-10-28T00:00:00.000Z' && saved.travel_end_date?.toISOString() === '2026-11-01T00:00:00.000Z' && saved.travel_destination === 'Fabricated trip', 'independent travel patches and millisecond dates')
  await refuses(() => readD1Travel(child, db), 403)
  function racing(sql: string): D1Store { return { prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const primary = db.withSession('first-primary')
    return { prepare: primary.prepare.bind(primary), async batch(statements) { await db.prepare(sql).run(); return primary.batch(statements) } }
  } } }
  await refuses(() => updateD1Travel(actor, { travel_destination: 'Must not save' }, racing(`UPDATE "Family" SET features=json_set(features,'$.travel',json('false')) WHERE id='read-family-a'`)), 403)
  check((await db.prepare(`SELECT travel_destination FROM "Family" WHERE id='read-family-a'`).first<{ travel_destination: string }>())!.travel_destination === 'Fabricated trip', 'disabled travel never writes')
  try { await refuses(() => updateD1AiSettings(actor, { capture_ai_model: 'Must not save' }, racing(`UPDATE "User" SET token_version=1 WHERE id='read-a'`)), 401) }
  finally { await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='read-a'`).run() }
  check((await readD1AiSettings(actor, db)).capture_ai_model === null, 'revoked AI writer leaves settings unchanged')
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.travel',json('true')) WHERE id='read-family-a'`).run()
  const cleared = await updateD1Travel(actor, { travel_start_date: null, travel_end_date: null, travel_destination: null }, db)
  check(cleared.travel_start_date === null && cleared.travel_end_date === null && cleared.travel_destination === null && cleared.travel_mode_active, 'explicit travel clears preserve omitted switch')
  return { concurrentFeedCreate: 8, feedRotation: true, aiKeyPreservationAndClear: true, householdIsolation: true, childRefusal: true, partialTravelRace: 4, dates: true, liveFeatureGate: true, sessionRace: true, roleScopedSettingsSeed: true }
}
