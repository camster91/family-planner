import type { D1Store } from '../../../src/lib/cloudflare/database'
import { hashToken } from '../../../src/lib/tokens'
import { readD1BoardSettings, updateD1BoardSettings, readD1DeviceBoardSettings, updateD1DeviceBoardSettings } from '../../../src/lib/cloudflare/board-settings'

function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

/** Native board settings smoke with fabricated household identities and photos. */
export async function testBoardSettings(db: D1Store) {
  const now = new Date('2026-10-28T16:00:00Z')
  const familyId = 'native-board-settings-a', foreignFamilyId = 'native-board-settings-b'
  const parentId = 'native-board-settings-parent', childId = 'native-board-settings-child', foreignId = 'native-board-settings-foreign'
  const photoId = 'native-board-settings-photo', deviceId = 'native-board-settings-device', sessionId = 'native-board-settings-session'
  const elevation = 'fpd1_e_fixture_board_settings'
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code,weather_unit,ambient_photo_ids)
    VALUES (?1,'Fixture board household',?1,'celsius',?2), (?3,'Foreign board household',?3,'celsius','[]')`)
    .bind(familyId, JSON.stringify([photoId]), foreignFamilyId).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,role,family_id,created_at)
    VALUES (?1,?2,'Board Parent','parent',?3,?7), (?4,?5,'Board Child','child',?3,?7), (?6,?8,'Foreign Parent','parent',?9,?7)`)
    .bind(parentId, 'board-settings-parent@example.test', familyId, childId, 'board-settings-child@example.test', foreignId, now.getTime(), 'board-settings-foreign-parent@example.test', foreignFamilyId).run()
  await db.prepare(`INSERT INTO "Upload" (id,family_id,filename,content_type,size_bytes,created_at)
    VALUES (?1,?2,'0123456789abcdef.jpg','image/jpeg',100,?3), ('native-board-settings-heic',?2,'0123456789abcde0.heic','image/heic',100,?3), ('native-board-settings-foreign-photo',?4,'fedcba9876543210.jpg','image/jpeg',100,?3)`)
    .bind(photoId, familyId, now.getTime(), foreignFamilyId).run()
  await db.prepare(`INSERT INTO "HouseholdDevice"
    (id,family_id,label,platform,elevation_token_hash,elevated_user_id,elevated_token_version,elevation_method,elevation_started_at,elevation_last_used_at,elevation_expires_at)
    VALUES (?1,?2,'Fixture board tablet','web',?3,?4,0,'pin',?5,?5,?6)`)
    .bind(deviceId, familyId, hashToken(elevation), parentId, now.getTime(), now.getTime() + 10 * 60 * 1000).run()
  await db.prepare(`INSERT INTO "DeviceSession"
    (id,device_id,family_id,access_token_hash,access_expires_at,refresh_token_hash,refresh_expires_at,created_at)
    VALUES (?1,?2,?3,?4,?5,'fixture-board-refresh',?5,?6)`)
    .bind(sessionId, deviceId, familyId, hashToken('fpd1_a_fixture_board_settings'), now.getTime() + 60 * 60 * 1000, now.getTime()).run()

  const person = { userId: parentId, familyId, tokenVersion: 0 }
  const initial = await readD1BoardSettings(person, db)
  check(initial.status === 200, 'person board settings read')
  const initialBody = initial.body as { display: { photoIds: string[]; uploads: unknown[] }; members: unknown[] }
  check(initialBody.display.photoIds.includes(photoId) && initialBody.display.uploads.length === 1, `photo picker privacy and selected photo: ${JSON.stringify(initial.body)}`)
  check(initialBody.members.length === 2, 'household members only')
  const saved = await updateD1BoardSettings(person, { memberColors: { [childId]: 'sky' }, display: { idleMinutes: 10, photoIds: [photoId] } }, now, db)
  check(saved.status === 200, 'person board settings write')
  check((await db.prepare('SELECT board_color FROM "User" WHERE id=?1').bind(childId).first<{ board_color: string }>())?.board_color === 'sky', 'member colour persisted')
  check((await db.prepare('SELECT count(*) AS n FROM "AuditLog" WHERE family_id=?1 AND action=\'board_settings.changed\'').bind(familyId).first<{ n: number }>())?.n === 1, 'household audit persisted')
  const foreignPhoto = await updateD1BoardSettings(person, { display: { photoIds: ['native-board-settings-foreign-photo'] } }, now, db)
  check(foreignPhoto.status === 400, 'foreign photo refused')
  check((await db.prepare('SELECT ambient_photo_ids FROM "Family" WHERE id=?1').bind(familyId).first<{ ambient_photo_ids: string }>())?.ambient_photo_ids === JSON.stringify([photoId]), 'foreign photo did not write')

  const device = { kind: 'device_elevated_parent' as const, deviceId, familyId, sessionId, label: 'Fixture board tablet', parentId, parentName: 'Board Parent' }
  const deviceRead = await readD1DeviceBoardSettings(device, elevation, now, db)
  check(deviceRead.status === 200, 'device board settings read')
  const deviceBody = deviceRead.body as { weather: { place: unknown }; display: Record<string, unknown> }
  check(deviceBody.weather.place === null && !('photoIds' in deviceBody.display), 'device privacy projection')
  const deviceSaved = await updateD1DeviceBoardSettings(device, elevation, { memberColors: { [childId]: 'green' }, display: { idleMinutes: 15 }, deviceWrites: { enabled: true } }, now, db)
  check(deviceSaved.status === 200, `device board settings write: ${JSON.stringify(deviceSaved)}`)
  check((await db.prepare('SELECT device_writes_enabled AS enabled FROM "Family" WHERE id=?1').bind(familyId).first<{ enabled: number }>())?.enabled === 1, 'device writes persisted')
  const event = await db.prepare('SELECT metadata FROM "DeviceAuditEvent" WHERE device_id=?1 AND type=\'device.elevated_action\' ORDER BY created_at DESC LIMIT 1').bind(deviceId).first<{ metadata: string }>()
  check(event?.metadata.includes('update_board_settings') && event.metadata.includes('memberColors'), 'device audit persisted')
  const rejectedPhoto = await updateD1DeviceBoardSettings(device, elevation, { display: { photoIds: [photoId] } }, now, db)
  check(rejectedPhoto.status === 400, 'device photo write refused')
  await db.prepare('UPDATE "HouseholdDevice" SET elevation_expires_at=?1 WHERE id=?2').bind(now.getTime() - 1, deviceId).run()
  const expired = await readD1DeviceBoardSettings(device, elevation, now, db)
  check(expired.status === 403 && expired.code === 'ELEVATION_EXPIRED', 'expired elevation refused')
  return { personPrivacy: true, personWrite: true, foreignPhotoRefusal: true, devicePrivacy: true, deviceWrite: true, audit: true, elevationExpiry: true }
}
