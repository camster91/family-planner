import { storeD1ChoreUpload, canD1FamilyReadChorePhoto, pruneD1UnreferencedUploads } from '../../../src/lib/cloudflare/uploads'
import { storeD1MessageAttachment, getD1MessageAttachment, pruneD1MessageAttachments } from '../../../src/lib/cloudflare/message-attachments'
import { privateObjectGenerationKey, privateObjectKey, type PrivateObjectStore } from '../../../src/lib/cloudflare/storage'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

/**
 * Disposable local D1 fixture. The R2 double is intentionally private and
 * family-keyed; this exercises metadata/object recovery without a provider or
 * a public bucket.
 */
export async function testStorage(db: D1Store) {
  const objects = new Map<string, Uint8Array>()
  const bucket = {
    async head(key: string) { return objects.has(key) ? { etag: 'fixture-etag' } : null },
    async put(key: string, value: Uint8Array) { objects.set(key, new Uint8Array(value)); return { etag: 'fixture-etag' } },
    async get(key: string) {
      const value = objects.get(key)
      if (!value) return null
      return { body: new ReadableStream({ start(controller) { controller.enqueue(value); controller.close() } }), etag: 'fixture-etag', httpMetadata: { contentType: 'image/png' } }
    },
    async delete(key: string) { objects.delete(key) },
  } as unknown as PrivateObjectStore
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code) VALUES ('storage-a','Storage A','storage-a'),('storage-b','Storage B','storage-b')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,email_verified) VALUES
    ('storage-parent','storage-parent@example.test','Storage Parent','storage-a','parent',1),
    ('storage-other','storage-other@example.test','Storage Other','storage-b','parent',1)`).run()
  const bytes = new Uint8Array([137,80,78,71,1,2,3])
  const firstActor = { userId: 'storage-parent', familyId: 'storage-a', generation: 0 }
  const first = await storeD1ChoreUpload({ actor: firstActor, bytes, filename: '0123456789abcdef.png', contentType: 'image/png', bucket, database: db })
  check(first.kind === 'ok' && first.created, 'first chore upload commits metadata and object')
  check(first.kind === 'ok' && objects.has(privateObjectGenerationKey('storage-a', 'chores', first.row.filename, first.row.id)), 'private chore object exists')
  const staleGeneration = await storeD1ChoreUpload({ actor: { ...firstActor, generation: 1 }, bytes, filename: '0123456789abcdef.png', contentType: 'image/png', bucket, database: db })
  check(staleGeneration.kind === 'gone', 'dedupe rechecks session generation')
  await db.prepare(`UPDATE "User" SET family_id='storage-b' WHERE id='storage-parent'`).run()
  const staleMembership = await storeD1ChoreUpload({ actor: firstActor, bytes, filename: '0123456789abcdef.png', contentType: 'image/png', bucket, database: db })
  check(staleMembership.kind === 'gone', 'dedupe rechecks current household membership')
  await db.prepare(`UPDATE "User" SET family_id='storage-a' WHERE id='storage-parent'`).run()
  const repeat = await storeD1ChoreUpload({ actor: { userId: 'storage-parent', familyId: 'storage-a', generation: 0 }, bytes, filename: '0123456789abcdef.png', contentType: 'image/png', bucket, database: db })
  check(repeat.kind === 'ok' && !repeat.created, 'same household upload deduplicates')
  const collisionName = '4444444444444444.png'
  const foreignUpload = await storeD1ChoreUpload({ actor: { userId: 'storage-other', familyId: 'storage-b', generation: 0 }, bytes, filename: collisionName, contentType: 'image/png', bucket, database: db })
  check(foreignUpload.kind === 'ok' && objects.has(privateObjectGenerationKey('storage-b', 'chores', collisionName, foreignUpload.row.id)), 'foreign fixture upload exists')
  const collision = await storeD1ChoreUpload({ actor: { userId: 'storage-parent', familyId: 'storage-a', generation: 0 }, bytes, filename: collisionName, contentType: 'image/png', bucket, database: db })
  check(collision.kind === 'collision', 'foreign filename collision refused')
  check(![...objects.keys()].some(key => key.startsWith('families/storage-a/chores/') && key.endsWith(`/${collisionName}`)), 'foreign collision compensates own object')
  check(await canD1FamilyReadChorePhoto('storage-a', '0123456789abcdef.png', db), 'own chore read admitted')
  check(!await canD1FamilyReadChorePhoto('storage-b', '0123456789abcdef.png', db), 'foreign chore read refused')
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,due_date,created_by,assigned_to,photo_url) VALUES ('storage-legacy-chore','storage-a','Legacy fixture chore',1,'storage-parent','storage-parent','/api/files/2222222222222222.png')`).run()
  check(await canD1FamilyReadChorePhoto('storage-a', '2222222222222222.png', db), 'legacy unscoped file route remains household-readable')
  check(!await canD1FamilyReadChorePhoto('storage-b', '2222222222222222.png', db), 'legacy unscoped file route remains household-isolated')
  await db.prepare(`INSERT INTO "Upload"(id,family_id,filename,content_type,size_bytes,created_at) VALUES ('storage-stale','storage-a','1111111111111111.png','image/png',1,?1)`).bind(Date.now() - 31 * 24 * 60 * 60 * 1000).run()
  await bucket.put(privateObjectKey('storage-a', 'chores', '1111111111111111.png'), new Uint8Array([1]))
  check(await pruneD1UnreferencedUploads({ familyId: 'storage-a', bucket, database: db }) === 1, 'stale chore metadata and object prune together')
  check(!objects.has(privateObjectKey('storage-a', 'chores', '1111111111111111.png')), 'stale object removed only after metadata commit')
  const raceFilename = '5555555555555555.png'
  await db.prepare(`INSERT INTO "Upload"(id,family_id,filename,content_type,size_bytes,created_at) VALUES ('storage-race','storage-a',?1,'image/png',1,?2)`).bind(raceFilename, Date.now() - 31 * 24 * 60 * 60 * 1000).run()
  const raceKey = privateObjectKey('storage-a', 'chores', raceFilename)
  await bucket.put(raceKey, new Uint8Array([2]))
  let raceResult: unknown
  const raceBucket = {
    ...bucket,
    async delete(key: string) {
      if (key === raceKey && raceResult === undefined) {
        raceResult = await storeD1ChoreUpload({ actor: firstActor, bytes, filename: raceFilename, contentType: 'image/png', bucket, database: db }).catch(error => error)
      }
      await bucket.delete(key)
    },
  } as unknown as PrivateObjectStore
  check(await pruneD1UnreferencedUploads({ familyId: 'storage-a', bucket: raceBucket, database: db }) === 1, 'cleanup claims stale row before object removal')
  check(raceResult instanceof Error, 'same-name upload cannot admit during cleanup lease')
  check(!objects.has(raceKey), 'cleanup removes object only after lease-protected metadata removal')
  const recoveredFilename = '6666666666666666.png'
  await db.prepare(`INSERT INTO "Upload"(id,family_id,filename,content_type,size_bytes,created_at) VALUES ('storage-recovered','storage-a',?1,'image/png',1,?2)`).bind(recoveredFilename, Date.now() - 31 * 24 * 60 * 60 * 1000).run()
  await db.prepare(`INSERT INTO "UploadCleanupLease"(id,family_id,filename,upload_id,created_at) VALUES ('storage-expired-lease','storage-a',?1,'storage-recovered',?2)`).bind(recoveredFilename, Date.now() - 6 * 60 * 1000).run()
  const recoveredLegacyKey = privateObjectKey('storage-a', 'chores', recoveredFilename)
  await bucket.put(recoveredLegacyKey, new Uint8Array([3]))
  const recovered = await storeD1ChoreUpload({ actor: firstActor, bytes, filename: recoveredFilename, contentType: 'image/png', bucket, database: db })
  check(recovered.kind === 'ok' && !recovered.created, 'expired cleanup lease recovers without blocking dedupe')
  check(recovered.kind === 'ok' && objects.has(privateObjectGenerationKey('storage-a', 'chores', recoveredFilename, recovered.row.id)), 'expired lease recovery republishes missing object')
  const delayedFilename = '7777777777777777.png'
  const delayedId = 'storage-delayed-old'
  await db.prepare(`INSERT INTO "Upload"(id,family_id,filename,content_type,size_bytes,created_at) VALUES (?1,'storage-a',?2,'image/png',1,?3)`).bind(delayedId, delayedFilename, Date.now() - 31 * 24 * 60 * 60 * 1000).run()
  const delayedKey = privateObjectGenerationKey('storage-a', 'chores', delayedFilename, delayedId)
  await bucket.put(delayedKey, new Uint8Array([4]))
  let startOldDelete!: () => void
  let releaseOldDelete!: () => void
  const oldDeleteStarted = new Promise<void>(resolve => { startOldDelete = resolve })
  const oldDeleteGate = new Promise<void>(resolve => { releaseOldDelete = resolve })
  const delayedBucket = {
    ...bucket,
    async delete(key: string) {
      if (key === delayedKey) {
        startOldDelete()
        await oldDeleteGate
      }
      await bucket.delete(key)
    },
  } as unknown as PrivateObjectStore
  const delayedPrune = pruneD1UnreferencedUploads({ familyId: 'storage-a', bucket: delayedBucket, database: db })
  await oldDeleteStarted
  await db.prepare(`UPDATE "UploadCleanupLease" SET created_at=?1 WHERE upload_id=?2`).bind(Date.now() - 6 * 60 * 1000, delayedId).run()
  const replacement = await storeD1ChoreUpload({ actor: firstActor, bytes, filename: delayedFilename, contentType: 'image/png', bucket, database: db })
  check(replacement.kind === 'ok' && replacement.created, 'same filename replacement admits after expired cleanup recovery')
  check(replacement.kind === 'ok' && objects.has(privateObjectGenerationKey('storage-a', 'chores', delayedFilename, replacement.row.id)), 'replacement uses a distinct immutable object key')
  releaseOldDelete()
  check(await delayedPrune === 1, 'delayed old cleanup completes')
  check(replacement.kind === 'ok' && objects.has(privateObjectGenerationKey('storage-a', 'chores', delayedFilename, replacement.row.id)), 'delayed old delete cannot remove replacement object')
  const failingDb: D1Store = {
    prepare: db.prepare.bind(db),
    batch: db.batch.bind(db),
    withSession() {
      const session = db.withSession('first-primary')
      return {
        prepare: session.prepare.bind(session),
        async batch() { throw new Error('fixture D1 failure') },
      }
    },
  }
  const failedChorePrefix = 'families/storage-a/chores/'
  try {
    await storeD1ChoreUpload({ actor: { userId: 'storage-parent', familyId: 'storage-a', generation: 0 }, bytes, filename: '3333333333333333.png', contentType: 'image/png', bucket, database: failingDb })
  } catch { /* expected: ownership failure compensates the R2 object */ }
  check(![...objects.keys()].some(key => key.startsWith(failedChorePrefix) && key.endsWith('/3333333333333333.png')), 'failed chore metadata admission removes its unpublished object')
  const message = await storeD1MessageAttachment({ familyId: 'storage-a', userId: 'storage-parent', generation: 0, bytes, contentType: 'image/png', ext: 'png', bucket, database: db })
  check(message.id.length > 0 && await getD1MessageAttachment('storage-a', message.id, db) === null, 'unclaimed message draft is not served')
  check(objects.has(privateObjectGenerationKey('storage-a', 'messages', message.filename, message.id)), 'private message object exists')
  await db.prepare(`INSERT INTO "Message"(id,family_id,sender_id,content) VALUES ('storage-message','storage-a','storage-parent','Fixture message')`).run()
  await db.prepare(`UPDATE "MessageAttachment" SET message_id='storage-message' WHERE id=?1`).bind(message.id).run()
  check(await getD1MessageAttachment('storage-a', message.id, db) !== null, 'claimed message attachment is readable in-family')
  check(await getD1MessageAttachment('storage-b', message.id, db) === null, 'claimed message attachment is not readable cross-household')
  const staleMessage = await storeD1MessageAttachment({ familyId: 'storage-a', userId: 'storage-parent', generation: 0, bytes: new Uint8Array([...bytes, 4]), contentType: 'image/png', ext: 'png', bucket, database: db })
  await db.prepare(`UPDATE "MessageAttachment" SET created_at=?1 WHERE id=?2`).bind(Date.now() - 2 * 24 * 60 * 60 * 1000, staleMessage.id).run()
  check(await pruneD1MessageAttachments({ familyId: 'storage-a', bucket, database: db }) === 1, 'unclaimed message draft prunes metadata and object')
  check(await getD1MessageAttachment('storage-a', message.id, db) !== null, 'claimed message survives draft cleanup')
  const messageKeysBeforeFailure = new Set([...objects.keys()].filter(key => key.includes('/messages/')))
  try {
    await storeD1MessageAttachment({ familyId: 'storage-a', userId: 'storage-parent', generation: 0, bytes: new Uint8Array([...bytes, 5]), contentType: 'image/png', ext: 'png', bucket, database: failingDb })
  } catch { /* expected: ownership failure compensates the R2 object */ }
  check(new Set([...objects.keys()].filter(key => key.includes('/messages/'))).size === messageKeysBeforeFailure.size, 'failed message metadata admission removes its unpublished object')
  return { privateKeys: true, choreDeduplication: true, householdIsolation: true, staleRecovery: true, cleanupLeaseRace: true, leaseRecovery: true, immutableGenerationRace: true, messageDraftLifecycle: true, objectCompensation: true }
}
