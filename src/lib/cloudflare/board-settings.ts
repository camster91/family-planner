import type { EffectResult } from '@/lib/idempotency'
import {
  boardSettingsSummary,
  prepareD1AuditLog,
} from '@/lib/household-audit'
import {
  changedBoardSections,
  parseBoardSettingsPatch,
  projectBoardSettings,
  type BoardSettingsFamily,
  type BoardSettingsPatch,
  type BoardSettingsSection,
  type BoardSettingsSnapshot,
} from '@/lib/board-settings'
import {
  ELEVATION_IDLE_MS,
  elevationEndReason,
  elevationHeaderMatches,
  type ElevatedParentActor,
} from '@/lib/device-session'
import { writeD1DeviceAudit, type DeviceAuditInput } from '@/lib/device-audit'
import { isWeatherEnabled } from '@/lib/weather/board-weather'
import { isValidLatitude, isValidLongitude, roundCoordinate } from '@/lib/weather/open-meteo'
import { captureD1Reads } from './read-witness'
import type { D1ReadClient, NativeD1 } from './read-client'
import { getD1Database, type D1Store, type D1Statement } from './database'
import { d1WriteCheck, isD1WriteConflict } from './write-check'
import { readD1DeviceActor } from './device-sessions'

type PersonActor = { userId: string; familyId: string; tokenVersion: number }
type DeviceSettingsActor = ElevatedParentActor
type Result = EffectResult & { code?: string; message?: string }

type FamilyRow = BoardSettingsFamily & { ambient_photo_ids?: unknown }
type MemberRow = { id: string; name: string; board_color: string | null; created_at: Date }
type UploadRow = { id: string; filename: string; content_type: string; created_at: Date }
type UserAuthority = { id: string; family_id: string | null; role: string; token_version: number }
type ParentAuthority = UserAuthority & { name: string }

const DISPLAYABLE = ['image/jpeg', 'image/png', 'image/webp'] as const
const FAMILY_FIELDS = {
  weather_enabled: true,
  weather_latitude: true,
  weather_longitude: true,
  weather_label: true,
  weather_unit: true,
  ambient_idle_minutes: true,
  night_start: true,
  night_end: true,
  device_writes_enabled: true,
} as const

const failure = (status: number, error: string, code?: string, message?: string): Result => ({
  status,
  body: code ? { error: { code, message: message ?? error } } : { error },
  code,
  message: message ?? error,
})

const personFailure = (status: number, error: string): Result => ({ status, body: { error } })

function jsonArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function familyForProjection(row: FamilyRow | null, photoIds?: string[]): BoardSettingsFamily | null {
  if (!row) return null
  return {
    weather_enabled: Boolean(row.weather_enabled),
    weather_latitude: row.weather_latitude == null ? null : Number(row.weather_latitude),
    weather_longitude: row.weather_longitude == null ? null : Number(row.weather_longitude),
    weather_label: row.weather_label ?? null,
    weather_unit: row.weather_unit,
    ambient_idle_minutes: Number(row.ambient_idle_minutes),
    night_start: row.night_start ?? null,
    night_end: row.night_end ?? null,
    device_writes_enabled: Boolean(row.device_writes_enabled),
    ...(photoIds ? { ambient_photo_ids: photoIds } : {}),
  }
}

function snapshotFromFamily(row: FamilyRow | null, members: MemberRow[], photoIds: string[]): BoardSettingsSnapshot {
  if (!row) return { family: null, colors: members.map(({ id, board_color }) => ({ id, board_color })) }
  return {
    family: {
      weather_enabled: Boolean(row.weather_enabled),
      weather_latitude: row.weather_latitude == null ? null : Number(row.weather_latitude),
      weather_longitude: row.weather_longitude == null ? null : Number(row.weather_longitude),
      weather_label: row.weather_label ?? null,
      weather_unit: row.weather_unit,
      ambient_idle_minutes: Number(row.ambient_idle_minutes),
      night_start: row.night_start ?? null,
      night_end: row.night_end ?? null,
      ambient_photo_ids: photoIds,
      device_writes_enabled: Boolean(row.device_writes_enabled),
    },
    colors: members.map(({ id, board_color }) => ({ id, board_color })),
  }
}

function currentPhotoIds(row: FamilyRow | null): string[] {
  return jsonArray(row?.ambient_photo_ids)
}

async function uploadsFor(
  db: D1ReadClient,
  familyId: string,
  selectedIds: string[],
  validateIds: string[] = [],
) {
  const [recent, selected, requested] = await Promise.all([
    db.upload.findMany({
      where: { family_id: familyId, content_type: { in: [...DISPLAYABLE] } },
      select: { id: true, filename: true, content_type: true, created_at: true },
      orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
      take: 60,
    }),
    selectedIds.length
      ? db.upload.findMany({
          where: { family_id: familyId, id: { in: selectedIds }, content_type: { in: [...DISPLAYABLE] } },
          select: { id: true, filename: true, content_type: true, created_at: true },
        })
      : Promise.resolve([] as UploadRow[]),
    validateIds.length
      ? db.upload.findMany({
          where: { family_id: familyId, id: { in: validateIds }, content_type: { in: [...DISPLAYABLE] } },
          select: { id: true, filename: true, content_type: true, created_at: true },
        })
      : Promise.resolve([] as UploadRow[]),
  ])
  const seen = new Set(recent.map((upload) => upload.id))
  return { recent, uploads: [...recent, ...selected.filter((upload) => !seen.has(upload.id))], requested }
}

async function state(
  db: D1ReadClient,
  familyId: string,
  audience: 'person' | 'device',
  requestedPhotoIds: string[] = [],
) {
  const family = audience === 'device'
    ? await db.family.findUnique({ where: { id: familyId }, select: FAMILY_FIELDS })
    : await db.family.findUnique({ where: { id: familyId }, select: { ...FAMILY_FIELDS, ambient_photo_ids: true } })
  const members = await db.user.findMany({
    where: { family_id: familyId },
    select: { id: true, name: true, board_color: true, created_at: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  })
  const selectedPhotoIds = audience === 'person' ? currentPhotoIds(family as FamilyRow | null) : []
  const picker = audience === 'person'
    ? await uploadsFor(db, familyId, selectedPhotoIds, requestedPhotoIds)
    : { recent: [] as UploadRow[], uploads: [] as UploadRow[], requested: [] as UploadRow[] }
  return {
    family: family as FamilyRow | null,
    members: members as MemberRow[],
    uploads: picker.uploads,
    recentUploads: audience === 'person' ? picker.recent as UploadRow[] : [],
    requestedUploads: picker.requested,
    photoIds: selectedPhotoIds,
  }
}

type LoadedState = Awaited<ReturnType<typeof state>> & { family: FamilyRow }
type PersonRead = { status: 200; body: unknown; loaded: LoadedState; user: UserAuthority }
type DeviceRead = { status: 200; body: unknown; loaded: LoadedState; access: Awaited<ReturnType<typeof readD1DeviceActor>> & { ok: true }; parent: ParentAuthority }

function uploadsForSelection(loaded: LoadedState, selectedIds: string[]): UploadRow[] {
  const recent = loaded.recentUploads
  const byId = new Map([...loaded.uploads, ...loaded.requestedUploads].map((upload) => [upload.id, upload]))
  const recentIds = new Set(recent.map((upload) => upload.id))
  return [...recent, ...selectedIds.map((id) => byId.get(id)).filter((upload): upload is UploadRow => !!upload && !recentIds.has(upload.id))]
}

async function readPerson(db: D1ReadClient, actor: PersonActor): Promise<Result | PersonRead> {
  const user = await db.user.findUnique({
    where: { id: actor.userId },
    select: { id: true, family_id: true, role: true, token_version: true },
  }) as UserAuthority | null
  if (!user || user.token_version !== actor.tokenVersion) return personFailure(401, 'Unauthorized')
  if (user.family_id !== actor.familyId || user.role !== 'parent') return personFailure(403, 'Forbidden')
  const loadedValue = await state(db, actor.familyId, 'person')
  if (!loadedValue.family) return personFailure(404, 'Family not found')
  const loaded = { ...loadedValue, family: loadedValue.family } as LoadedState
  return {
    status: 200,
    body: projectBoardSettings(
      familyForProjection(loaded.family, loaded.photoIds),
      loaded.members,
      loaded.uploads,
      'person',
    ),
    loaded,
    user,
  } as PersonRead
}

async function readDevice(db: D1ReadClient, actor: DeviceSettingsActor, header: string | null | undefined, now: Date): Promise<Result | DeviceRead> {
  const access = await readD1DeviceActor(db, { ...actor, kind: 'device' }, now)
  if (!access.ok) return failure(access.status, access.code, access.code)
  if (!elevationHeaderMatches(access.device, header)) return failure(403, 'Elevation required', 'ELEVATION_REQUIRED')
  const reason = elevationEndReason(access.device, now)
  if (reason) return failure(403, 'Elevation expired', 'ELEVATION_EXPIRED')
  const parent = access.device.elevated_user_id
    ? await db.user.findUnique({
        where: { id: access.device.elevated_user_id },
        select: { id: true, name: true, family_id: true, role: true, token_version: true },
      }) as ParentAuthority | null
    : null
  if (!parent || parent.id !== actor.parentId || parent.family_id !== actor.familyId || parent.role !== 'parent' || parent.token_version !== access.device.elevated_token_version)
    return failure(403, 'Elevation expired', 'ELEVATION_EXPIRED')
  const loadedValue = await state(db, actor.familyId, 'device')
  if (!loadedValue.family) return failure(404, 'Family not found', 'NOT_FOUND')
  const loaded = { ...loadedValue, family: loadedValue.family } as LoadedState
  return {
    status: 200,
    body: projectBoardSettings(familyForProjection(loaded.family), loaded.members, [], 'device'),
    loaded,
    access,
    parent,
  } as DeviceRead
}

async function readCaptured<T>(read: (db: D1ReadClient) => Promise<T>, database: D1Store) {
  return captureD1Reads(read, database as unknown as NativeD1)
}

export async function readD1BoardSettings(actor: PersonActor, database?: D1Store): Promise<Result> {
  const store = database ?? await getD1Database()
  const captured = await readCaptured((db) => readPerson(db, actor), store)
  return captured.value as Result
}

export async function readD1DeviceBoardSettings(
  actor: DeviceSettingsActor,
  header: string | null | undefined,
  now = new Date(),
  database?: D1Store,
): Promise<Result> {
  const store = database ?? await getD1Database()
  for (let attempt = 0; attempt < 12; attempt++) {
    const captured = await readCaptured((db) => readDevice(db, actor, header, now), store)
    const session = store.withSession('first-primary')
    try {
      if (captured.value.status !== 200) {
        await session.batch(captured.checks(session))
        return captured.value as Result
      }
      const { access } = captured.value as Extract<typeof captured.value, { status: 200 }>
      await session.batch([
        ...captured.checks(session),
        ...renewElevation(session, access.device, actor, now),
      ])
      return captured.value as Result
    } catch (cause) {
      if (!isD1WriteConflict(cause)) throw cause
    }
  }
  return failure(503, 'Service unavailable', 'SERVICE_UNAVAILABLE')
}

function renewElevation(
  session: Pick<D1Store, 'prepare'>,
  device: { id: string; family_id: string; elevation_token_hash: string | null; elevated_user_id: string | null; elevated_token_version: number | null },
  actor: DeviceSettingsActor,
  now: Date,
) {
  const at = now.getTime()
  return [
      session.prepare(`UPDATE "HouseholdDevice"
      SET elevation_last_used_at=?1,updated_at=?1
      WHERE id=?2 AND family_id=?3 AND revoked_at IS NULL
        AND elevation_token_hash=?4 AND elevated_user_id=?5
        AND elevated_token_version=?6 AND elevation_expires_at>?1
        AND elevation_last_used_at>?7`)
      .bind(at, device.id, actor.familyId, device.elevation_token_hash, actor.parentId, device.elevated_token_version, at - ELEVATION_IDLE_MS),
    d1WriteCheck(session, 'changes()=1'),
  ]
}

function normalizedPatch(
  before: ReturnType<typeof snapshotFromFamily>,
  loaded: { family: FamilyRow; members: MemberRow[] },
  patch: BoardSettingsPatch,
  audience: 'person' | 'device',
) {
  const source = loaded.family
  const nextFamily: FamilyRow = { ...source }
  const photoIds = currentPhotoIds(source)
  let nextPhotoIds = photoIds
  if (patch.weather) {
    if (patch.weather.place === null) {
      nextFamily.weather_latitude = null
      nextFamily.weather_longitude = null
      nextFamily.weather_label = null
      nextFamily.weather_enabled = false
    } else if (patch.weather.place !== undefined) {
      nextFamily.weather_latitude = roundCoordinate(patch.weather.place.latitude)
      nextFamily.weather_longitude = roundCoordinate(patch.weather.place.longitude)
      nextFamily.weather_label = patch.weather.place.label
    }
    if (patch.weather.unit !== undefined) nextFamily.weather_unit = patch.weather.unit
    if (patch.weather.enabled !== undefined) nextFamily.weather_enabled = patch.weather.enabled
  }
  if (patch.display) {
    if (patch.display.idleMinutes !== undefined) nextFamily.ambient_idle_minutes = patch.display.idleMinutes
    if (patch.display.night !== undefined) {
      nextFamily.night_start = patch.display.night?.start ?? null
      nextFamily.night_end = patch.display.night?.end ?? null
    }
    if (audience === 'person' && patch.display.photoIds !== undefined) nextPhotoIds = [...new Set(patch.display.photoIds)]
  }
  if (patch.deviceWrites) nextFamily.device_writes_enabled = patch.deviceWrites.enabled
  const nextMembers = loaded.members.map((member) => ({ ...member }))
  if (patch.memberColors) {
    for (const [id, color] of Object.entries(patch.memberColors)) {
      const member = nextMembers.find((candidate) => candidate.id === id)
      if (member) member.board_color = color
    }
  }
  return {
    family: nextFamily,
    members: nextMembers,
    photoIds: nextPhotoIds,
    before,
    after: snapshotFromFamily(nextFamily, nextMembers, nextPhotoIds),
  }
}

function validatePatch(
  patch: BoardSettingsPatch,
  loaded: { family: FamilyRow; members: MemberRow[]; requestedUploads: UploadRow[] },
  audience: 'person' | 'device',
) : string | null {
  const memberIds = patch.memberColors ? Object.keys(patch.memberColors) : []
  if (memberIds.some((id) => !loaded.members.some((member) => member.id === id))) return 'Unknown household member'
  if (audience === 'device' && patch.display?.photoIds !== undefined) return 'Unknown photo'
  if (patch.display?.photoIds !== undefined) {
    const ids = [...new Set(patch.display.photoIds)]
    if (loaded.requestedUploads.length !== ids.length) return 'Unknown photo'
  }
  const weather = patch.weather
  if (weather?.enabled && !isWeatherEnabled()) return 'Weather is not available on this server'
  const currentHasPlace = isValidLatitude(loaded.family.weather_latitude) && isValidLongitude(loaded.family.weather_longitude)
  const resultingPlace = weather?.place === null
    ? false
    : weather?.place !== undefined
      ? true
      : currentHasPlace
  if (weather?.enabled && !resultingPlace) return 'Choose a place before turning on weather'
  return null
}

function familyChanged(before: BoardSettingsSnapshot, after: BoardSettingsSnapshot): boolean {
  return changedBoardSections(before, after).some((section) => section !== 'memberColors')
}

function familyUpdate(session: Pick<D1Store, 'prepare'>, familyId: string, family: FamilyRow, photoIds: string[], includePhotos: boolean) {
  const columns = includePhotos
    ? `weather_enabled=?1,weather_latitude=?2,weather_longitude=?3,weather_label=?4,weather_unit=?5,
    ambient_idle_minutes=?6,night_start=?7,night_end=?8,ambient_photo_ids=?9,device_writes_enabled=?10`
    : `weather_enabled=?1,weather_latitude=?2,weather_longitude=?3,weather_label=?4,weather_unit=?5,
    ambient_idle_minutes=?6,night_start=?7,night_end=?8,device_writes_enabled=?9`
  const values = includePhotos
    ? [family.weather_enabled ? 1 : 0, family.weather_latitude, family.weather_longitude, family.weather_label, family.weather_unit,
      family.ambient_idle_minutes, family.night_start, family.night_end, JSON.stringify(photoIds), family.device_writes_enabled ? 1 : 0, familyId]
    : [family.weather_enabled ? 1 : 0, family.weather_latitude, family.weather_longitude, family.weather_label, family.weather_unit,
      family.ambient_idle_minutes, family.night_start, family.night_end, family.device_writes_enabled ? 1 : 0, familyId]
  return session.prepare(`UPDATE "Family" SET
    ${columns} WHERE id=?${includePhotos ? 11 : 10}`).bind(...values)
}

function memberUpdates(session: Pick<D1Store, 'prepare'>, familyId: string, before: MemberRow[], after: MemberRow[]) {
  const statements: D1Statement[] = []
  for (const next of after) {
    const prior = before.find((member) => member.id === next.id)
    if (!prior || prior.board_color === next.board_color) continue
    statements.push(session.prepare('UPDATE "User" SET board_color=?1 WHERE id=?2 AND family_id=?3').bind(next.board_color, next.id, familyId))
    statements.push(d1WriteCheck(session, 'changes()=1'))
  }
  return statements
}

function writeNext(
  loaded: LoadedState,
  patch: BoardSettingsPatch,
  audience: 'person' | 'device',
) {
  const before = snapshotFromFamily(loaded.family, loaded.members, currentPhotoIds(loaded.family))
  const normalized = normalizedPatch(before, loaded, patch, audience)
  const next = {
    ...normalized,
    beforeMembers: loaded.members,
    patchWeatherInvalidation: patch.weather?.place !== undefined || patch.weather?.enabled === false,
  }
  return { before, next, changed: changedBoardSections(before, next.after) }
}

async function updatePersonOnce(actor: PersonActor, raw: unknown, now: Date, store: D1Store): Promise<Result> {
  const parsed = parseBoardSettingsPatch(raw, 'person')
  if (!parsed.ok) return personFailure(400, parsed.error)
  const captured = await readCaptured(async (db) => {
    const user = await db.user.findUnique({ where: { id: actor.userId }, select: { id: true, family_id: true, role: true, token_version: true } }) as UserAuthority | null
    if (!user || user.token_version !== actor.tokenVersion) return personFailure(401, 'Unauthorized')
    if (user.family_id !== actor.familyId || user.role !== 'parent') return personFailure(403, 'Forbidden')
    const requested = parsed.patch.display?.photoIds ?? []
    const loadedValue = await state(db, actor.familyId, 'person', requested)
    if (!loadedValue.family) return personFailure(404, 'Family not found')
    const loaded = { ...loadedValue, family: loadedValue.family } as LoadedState
    const invalid = validatePatch(parsed.patch, loaded, 'person')
    if (invalid) return personFailure(invalid === 'Weather is not available on this server' ? 409 : 400, invalid)
    const write = writeNext(loaded, parsed.patch, 'person')
    return { status: 200, loaded, write, user } as const
  }, store)
  if ('body' in captured.value && captured.value.status !== 200) {
    await store.withSession('first-primary').batch(captured.checks(store.withSession('first-primary')))
    return captured.value as Result
  }
  const session = store.withSession('first-primary')
  const value = captured.value as { status: 200; loaded: LoadedState; write: ReturnType<typeof writeNext>; user: UserAuthority }
  const { write, loaded } = value
  const authority = d1WriteCheck(session, `EXISTS(SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.userId, actor.familyId, actor.tokenVersion])
  const effects: D1Statement[] = [authority]
  if (familyChanged(write.before, write.next.after)) effects.push(familyUpdate(session, actor.familyId, write.next.family, write.next.photoIds, true), d1WriteCheck(session, 'changes()=1'))
  effects.push(...memberUpdates(session, actor.familyId, loaded.members, write.next.members))
  if (write.next.patchWeatherInvalidation) effects.push(session.prepare('DELETE FROM WeatherCache WHERE family_id=?1').bind(actor.familyId))
  if (write.changed.length) effects.push(...prepareD1AuditLog(session, {
    familyId: actor.familyId, actorUserId: actor.userId, actorKind: 'person', action: 'board_settings.changed', targetType: 'family', targetId: actor.familyId,
    summary: boardSettingsSummary(write.changed),
  }, now))
  try {
    await session.batch([...captured.checks(session), ...effects])
    return { status: 200, body: projectBoardSettings(familyForProjection(write.next.family, write.next.photoIds), write.next.members, uploadsForSelection(loaded, write.next.photoIds), 'person') }
  } catch (cause) {
    if (isD1WriteConflict(cause)) return failure(409, 'Settings changed', 'CONFLICT')
    throw cause
  }
}

export async function updateD1BoardSettings(actor: PersonActor, raw: unknown, now = new Date(), database?: D1Store): Promise<Result> {
  const store = database ?? await getD1Database()
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await updatePersonOnce(actor, raw, now, store)
    if (result.code !== 'CONFLICT') return result
  }
  return failure(503, 'Service unavailable', 'SERVICE_UNAVAILABLE')
}

async function updateDeviceOnce(actor: DeviceSettingsActor, header: string | null | undefined, raw: unknown, now: Date, store: D1Store): Promise<Result> {
  const parsed = parseBoardSettingsPatch(raw, 'device')
  if (!parsed.ok) return failure(400, parsed.error, 'VALIDATION_ERROR')
  const captured = await readCaptured(async (db) => {
    const read = await readDevice(db, actor, header, now)
    if (read.status !== 200) return read
    const authorized = read as DeviceRead
    const loaded = authorized.loaded
    const invalid = validatePatch(parsed.patch, loaded, 'device')
    if (invalid) return failure(invalid === 'Weather is not available on this server' ? 409 : 400, invalid, invalid === 'Unknown photo' ? 'VALIDATION_ERROR' : 'VALIDATION_ERROR')
    const write = writeNext(loaded, parsed.patch, 'device')
    return { status: 200, loaded, write, access: authorized.access, auditSections: parsed.sections } as const
  }, store)
  if (captured.value.status !== 200) {
    await store.withSession('first-primary').batch(captured.checks(store.withSession('first-primary')))
    return captured.value as Result
  }
  const session = store.withSession('first-primary')
  const value = captured.value as { status: 200; loaded: LoadedState; write: ReturnType<typeof writeNext>; access: DeviceRead['access']; auditSections: BoardSettingsSection[] }
  const { write, loaded, access } = value
  const authority = d1WriteCheck(session, `EXISTS(SELECT 1 FROM "User" WHERE id=?1 AND family_id=?2 AND role='parent' AND token_version=?3)`, [actor.parentId, actor.familyId, access.device.elevated_token_version ?? -1])
  const effects: D1Statement[] = [...renewElevation(session, access.device, actor, now), authority]
  if (familyChanged(write.before, write.next.after)) effects.push(familyUpdate(session, actor.familyId, write.next.family, write.next.photoIds, false), d1WriteCheck(session, 'changes()=1'))
  effects.push(...memberUpdates(session, actor.familyId, loaded.members, write.next.members))
  if (write.next.patchWeatherInvalidation) effects.push(session.prepare('DELETE FROM WeatherCache WHERE family_id=?1').bind(actor.familyId))
  if (write.changed.length) effects.push(...prepareD1AuditLog(session, {
    familyId: actor.familyId, actorUserId: actor.parentId, actorKind: 'device', action: 'board_settings.changed', targetType: 'family', targetId: actor.familyId,
    summary: boardSettingsSummary(write.changed),
  }, now))
  try {
    await session.batch([...captured.checks(session), ...effects])
    if (value.auditSections.length) {
      const security: DeviceAuditInput = {
        familyId: actor.familyId,
        deviceId: actor.deviceId,
        actorUserId: actor.parentId,
        at: now,
        type: 'device.elevated_action',
        metadata: { action: 'update_board_settings', targetType: 'family', targetId: actor.familyId, sections: value.auditSections },
      }
      await writeD1DeviceAudit(session, security)
    }
    return { status: 200, body: projectBoardSettings(familyForProjection(write.next.family), write.next.members, [], 'device') }
  } catch (cause) {
    if (isD1WriteConflict(cause)) return failure(409, 'Settings changed', 'CONFLICT')
    throw cause
  }
}

export async function updateD1DeviceBoardSettings(actor: DeviceSettingsActor, header: string | null | undefined, raw: unknown, now = new Date(), database?: D1Store): Promise<Result> {
  const store = database ?? await getD1Database()
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await updateDeviceOnce(actor, header, raw, now, store)
    if (result.code !== 'CONFLICT') return result
  }
  return failure(503, 'Service unavailable', 'SERVICE_UNAVAILABLE')
}
