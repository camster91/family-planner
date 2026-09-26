// Shared-device test helpers (#240). Builds on the two-household harness:
// family-A is household H1 (parent P1 = parent-a, teen T1, child C1, tablets
// D1 and D1b), family-B is H2 (parent P2 = parent-b, tablet D2). Every family-B
// text carries FOREIGN, so a body that contains it leaked the other household.
//
// Not a test file (jest only collects `*.test.ts`).
import bcrypt from 'bcryptjs'
import { db, FAMILY_A, FAMILY_B, USER_IDS, actAs, type UserKey } from './two-household'
import { hashToken } from '@/lib/tokens'
import { deviceClock } from '@/lib/device-http'
import { ACCESS_TTL_MS, REFRESH_TTL_MS } from '@/lib/device-session'

export const D1 = 'device-d1'
export const D1B = 'device-d1b'
export const D2 = 'device-d2'

/** H1 strings a device of another household must never see (and prohibited-domain canaries). */
export const H1_CANARIES = [
  'Household A',
  'Parent A',
  'Home dentist',
  'Home dishes',
  'Home milk',
  'Home pasta',
  'parent-a@example.test',
  'Home clinic',
  'Home password',
  'Home wifi',
  'Home school',
  'Home cough',
  'Home syrup',
  'Home peanuts',
  'Home pineapple',
  'Home shop',
  'Home hello',
  'Home bike',
  'Home birthday',
  'Home ice cream',
  'Home garage',
  'Home weekly',
  '1 Home Street',
  'INVITEA1',
  'feed-token-a',
  'share-token-a',
]

export function enableSharedDevice() {
  process.env.SHARED_DEVICE_ENABLED = 'true'
}

export function disableSharedDevice() {
  delete process.env.SHARED_DEVICE_ENABLED
}

let frozen: Date | null = null

/** Fix the device clock (used by every device route and helper). */
export function setNow(date: Date) {
  frozen = new Date(date)
  deviceClock.now = () => new Date(frozen!.getTime())
}

export function advance(ms: number) {
  setNow(new Date((frozen ?? new Date()).getTime() + ms))
}

export function resetClock() {
  frozen = null
  deviceClock.now = () => new Date()
}

export function now(): Date {
  return deviceClock.now()
}

export interface SeededDevice {
  deviceId: string
  sessionId: string
  access: string
  refresh: string
  cookies: Record<string, string>
}

let tokenSeq = 0

/** Insert a paired, active device with one live session generation. */
export function seedDevice(deviceId: string, familyId: string, label = 'Kitchen tablet'): SeededDevice {
  const t = now()
  tokenSeq += 1
  const access = `fpd1_a_test-${deviceId}-${tokenSeq}`
  const refresh = `fpd1_r_test-${deviceId}-${tokenSeq}`
  db.rows('householdDevice').push({
    id: deviceId,
    family_id: familyId,
    label,
    platform: 'android',
    created_by: familyId === FAMILY_A ? USER_IDS.parentA : USER_IDS.parentB,
    confirmed_by: familyId === FAMILY_A ? USER_IDS.parentA : USER_IDS.parentB,
    paired_at: t,
    last_seen_at: null,
    last_seen_app_version: '1.0',
    revoked_at: null,
    revoked_by: null,
    revoke_reason: null,
    elevation_token_hash: null,
    elevated_user_id: null,
    elevated_token_version: null,
    elevation_method: null,
    elevation_started_at: null,
    elevation_last_used_at: null,
    elevation_expires_at: null,
    created_at: t,
  })
  const sessionId = `session-${deviceId}-${tokenSeq}`
  db.rows('deviceSession').push({
    id: sessionId,
    device_id: deviceId,
    family_id: familyId,
    access_token_hash: hashToken(access),
    access_expires_at: new Date(t.getTime() + ACCESS_TTL_MS),
    refresh_token_hash: hashToken(refresh),
    refresh_expires_at: new Date(t.getTime() + REFRESH_TTL_MS),
    first_used_at: null,
    rotated_at: null,
    replaced_by_id: null,
    revoked_at: null,
    created_at: t,
  })
  return { deviceId, sessionId, access, refresh, cookies: { fp_device: access, fp_device_refresh: refresh } }
}

/** Standard fixture: D1 and D1b in H1, D2 in H2. */
export function seedDevices() {
  return {
    d1: seedDevice(D1, FAMILY_A, 'Kitchen tablet'),
    d1b: seedDevice(D1B, FAMILY_A, 'Hall tablet'),
    d2: seedDevice(D2, FAMILY_B, `${'FOREIGN'} tablet`),
  }
}

// Low bcrypt cost keeps the suite fast; production uses cost 12.
export function setPassword(who: UserKey, password: string) {
  db.find('user', USER_IDS[who])!.password = bcrypt.hashSync(password, 4)
}

export function setPin(who: UserKey, pin: string, familyId?: string) {
  const user = db.find('user', USER_IDS[who])!
  db.rows('parentElevationPin').push({
    user_id: user.id,
    family_id: familyId ?? user.family_id,
    pin_hash: bcrypt.hashSync(pin, 4),
    locked_until: null,
    created_at: now(),
    updated_at: now(),
  })
}

export type DeviceRequestOptions = {
  method?: string
  path?: string
  query?: Record<string, string>
  body?: unknown
  cookies?: Record<string, string | undefined>
  headers?: Record<string, string>
  /** Person session (session_token), optional. */
  as?: UserKey | null
  ip?: string
}

/** A request with arbitrary cookies/headers, e.g. only a device cookie. */
export function deviceReq(opts: DeviceRequestOptions = {}): any {
  const token = actAs(opts.as ?? null)
  const cookies: Record<string, string | undefined> = { ...(opts.cookies ?? {}) }
  if (token) cookies.session_token = token
  const url = new URL(`http://localhost${opts.path ?? '/api/device/test'}`)
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v)
  return {
    method: opts.method ?? 'GET',
    url: url.toString(),
    nextUrl: url,
    headers: new Headers({ 'x-forwarded-for': opts.ip ?? '198.51.100.7', ...(opts.headers ?? {}) }),
    cookies: { get: (name: string) => (cookies[name] ? { value: cookies[name] as string } : undefined) },
    json: async () => {
      if (opts.body === undefined) throw new SyntaxError('Unexpected end of JSON input')
      return opts.body
    },
    text: async () => JSON.stringify(opts.body ?? null),
  }
}

/** The value a response set for a cookie, or undefined if it was not set. */
export function setCookie(res: any, name: string): { value: string; options: Record<string, unknown> } | undefined {
  const all = (res?.setCookies ?? []).filter((c: any) => c.name === name)
  return all[all.length - 1]
}

export function clearsDeviceCookies(res: any): boolean {
  return ['fp_device', 'fp_device_refresh'].every((n) => {
    const c = setCookie(res, n)
    return c !== undefined && c.value === '' && c.options.maxAge === 0
  })
}

/** New cookies from a response, for the next request. */
export function nextCookies(res: any, prev: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const out = { ...prev }
  for (const c of res?.setCookies ?? []) out[c.name] = c.value || undefined
  return out
}

export async function errorCode(res: any): Promise<string | undefined> {
  const body = await res.json()
  return body?.error?.code
}

export { db, FAMILY_A, FAMILY_B, USER_IDS }
