// Notification policy table (#286, PR101 D-5). Fails when:
//   * a source file sends a notification type or account-mail kind that is not
//     in the table (so every new type gets an explicit category or ALWAYS);
//   * anything other than src/lib/notification-delivery.ts creates a
//     Notification row or calls sendMail (so nothing bypasses preferences);
//   * the table and the categories drift apart.
import fs from 'fs'
import path from 'path'
import {
  ACCOUNT_MAIL_POLICY,
  ALWAYS_SEND,
  CATEGORY_COLUMN,
  CATEGORY_COPY,
  DEFAULT_NOTIFICATION_PREFERENCES,
  IN_APP_NOTIFICATION_POLICY,
  IN_APP_NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_PREFERENCE_SELECT,
  OPT_IN_COLUMN,
  OPT_IN_KINDS,
  OPT_IN_MAIL_POLICY,
  allowsNotification,
  isInAppNotificationType,
  isParentSendableType,
  morningSummaryFromRow,
  preferencesFromRow,
  preferencesToColumns,
} from '../notification-policy'

const SRC = path.join(__dirname, '..', '..')
const DELIVERY = path.join(SRC, 'lib', 'notification-delivery.ts')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

const FILES = sourceFiles(SRC).map((file) => ({ file, rel: path.relative(SRC, file), text: fs.readFileSync(file, 'utf8') }))

// Calls that take a `{ ..., type: '<type>' }` notification object.
const SEND_CALL = /\b(deliverNotification|sendNotification|sendNotificationsToUsers|sendNotificationToFamily)\s*\(/g

function sentTypes(): Array<{ rel: string; type: string | null }> {
  const found: Array<{ rel: string; type: string | null }> = []
  for (const { rel, text } of FILES) {
    for (const match of text.matchAll(SEND_CALL)) {
      // Skip declarations such as `async sendNotification(data: ...)`.
      const before = text.slice(Math.max(0, match.index! - 12), match.index!)
      if (/(async|function)\s+$/.test(before)) continue
      const window = text.slice(match.index!, match.index! + 600)
      const literal = window.match(/\btype:\s*['"]([A-Za-z_]+)['"]/)
      // A call that forwards a variable (e.g. `{ ...data, userId }`) is typed
      // by InAppNotificationType; only literals need the table check here.
      found.push({ rel, type: literal ? literal[1] : null })
    }
  }
  return found
}

describe('notification policy table', () => {
  it('maps every in-app type to a category, ALWAYS or an opt-in kind, and nothing else', () => {
    for (const [type, policy] of Object.entries(IN_APP_NOTIFICATION_POLICY)) {
      expect([...NOTIFICATION_CATEGORIES, ALWAYS_SEND, ...OPT_IN_KINDS]).toContain(policy)
      expect(isInAppNotificationType(type)).toBe(true)
    }
    expect(IN_APP_NOTIFICATION_TYPES).toEqual(Object.keys(IN_APP_NOTIFICATION_POLICY))
    expect(isInAppNotificationType('achievement')).toBe(false)
    expect(isInAppNotificationType('toString')).toBe(false)
    expect(isInAppNotificationType(undefined)).toBe(false)
  })

  it('pins the current mapping (change deliberately, with the docs)', () => {
    expect(IN_APP_NOTIFICATION_POLICY).toEqual({
      chore: 'chores',
      reward: 'chores',
      event: 'events',
      message: 'messages',
      system: ALWAYS_SEND,
      summary: 'morning_summary',
    })
    expect(OPT_IN_MAIL_POLICY).toEqual({ morning_summary: 'morning_summary' })
  })

  it('keeps the morning summary opt-in: off unless switched on, never sendable by a parent (O-40)', () => {
    expect(OPT_IN_COLUMN).toEqual({ morning_summary: 'morning_summary_enabled' })
    expect(allowsNotification('summary', DEFAULT_NOTIFICATION_PREFERENCES)).toBe(false)
    expect(allowsNotification('summary', DEFAULT_NOTIFICATION_PREFERENCES, { morning_summary: false })).toBe(false)
    expect(allowsNotification('summary', DEFAULT_NOTIFICATION_PREFERENCES, { morning_summary: true })).toBe(true)
    expect(isParentSendableType('summary')).toBe(false)
    for (const type of ['chore', 'reward', 'event', 'message', 'system']) expect(isParentSendableType(type)).toBe(true)
    expect(isParentSendableType('nope')).toBe(false)
    expect(morningSummaryFromRow(null)).toEqual({ enabled: false, timeZone: null })
    expect(morningSummaryFromRow({ morning_summary_enabled: null })).toEqual({ enabled: false, timeZone: null })
    expect(
      morningSummaryFromRow({ morning_summary_enabled: true, morning_summary_time_zone: 'America/Toronto' })
    ).toEqual({ enabled: true, timeZone: 'America/Toronto' })
    // An unknown stored zone reads as none.
    expect(morningSummaryFromRow({ morning_summary_enabled: true, morning_summary_time_zone: 'Mars/Base' })).toEqual({
      enabled: true,
      timeZone: null,
    })
  })

  it('always sends account and safety mail: password reset, email checks and invites', () => {
    expect(ACCOUNT_MAIL_POLICY).toEqual({
      password_reset: ALWAYS_SEND,
      email_verification: ALWAYS_SEND,
      family_invite: ALWAYS_SEND,
    })
  })

  it('gives every category a column, plain-words copy and a default of on', () => {
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(CATEGORY_COLUMN[c]).toMatch(/^notify_[a-z]+$/)
      expect(NOTIFICATION_PREFERENCE_SELECT).toHaveProperty(CATEGORY_COLUMN[c], true)
      expect(CATEGORY_COPY[c].label.length).toBeGreaterThan(0)
      expect(CATEGORY_COPY[c].description.length).toBeGreaterThan(0)
      expect(DEFAULT_NOTIFICATION_PREFERENCES[c]).toBe(true)
    }
    // Every category is reachable from at least one type.
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(Object.values(IN_APP_NOTIFICATION_POLICY)).toContain(c)
    }
  })

  it('reads a missing or null column as on (the column default) and only false as off', () => {
    expect(preferencesFromRow(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    expect(preferencesFromRow({})).toEqual(DEFAULT_NOTIFICATION_PREFERENCES)
    expect(preferencesFromRow({ notify_chores: null, notify_events: false })).toEqual({
      chores: true,
      events: false,
      messages: true,
    })
    expect(preferencesToColumns({ events: false })).toEqual({ notify_events: false })
    expect(preferencesToColumns({ chores: true, messages: false })).toEqual({
      notify_chores: true,
      notify_messages: false,
    })
  })

  it('lets a muted category through only for ALWAYS types', () => {
    const allOff = { chores: false, events: false, messages: false }
    expect(allowsNotification('chore', allOff)).toBe(false)
    expect(allowsNotification('reward', allOff)).toBe(false)
    expect(allowsNotification('event', allOff)).toBe(false)
    expect(allowsNotification('message', allOff)).toBe(false)
    expect(allowsNotification('system', allOff)).toBe(true)
    // With default switches every type arrives except opt-in ones (off until turned on).
    for (const type of IN_APP_NOTIFICATION_TYPES) {
      expect(allowsNotification(type, DEFAULT_NOTIFICATION_PREFERENCES)).toBe(type !== 'summary')
    }
  })
})

describe('every notification in the source goes through the policy', () => {
  it('finds the known senders (guards the scan itself)', () => {
    const rels = new Set(sentTypes().map((s) => s.rel))
    expect(rels).toContain(path.join('app', 'api', 'chores', 'verify', 'route.ts'))
    expect(rels).toContain(path.join('app', 'api', 'rewards', 'claim', 'route.ts'))
    expect(rels).toContain(path.join('app', 'api', 'notifications', 'route.ts'))
  })

  it('sends only types that are in the table', () => {
    const unmapped = sentTypes().filter((s) => s.type !== null && !isInAppNotificationType(s.type))
    expect(unmapped).toEqual([])
  })

  it('sends only account-mail kinds that are in the table', () => {
    const kinds: string[] = []
    for (const { text } of FILES) {
      for (const m of text.matchAll(/\bsendAccountMail\(\s*['"]([A-Za-z_]+)['"]/g)) kinds.push(m[1])
    }
    expect(kinds.length).toBeGreaterThanOrEqual(4)
    for (const kind of kinds) expect(Object.keys(ACCOUNT_MAIL_POLICY)).toContain(kind)
  })

  it('creates Notification rows only in src/lib/notification-delivery.ts', () => {
    const creators = FILES.filter(({ text }) => /\bnotification\.(create|createMany|upsert)\s*\(/.test(text)).map(
      (f) => f.file
    )
    expect(creators).toEqual([DELIVERY])
  })

  it('calls sendMail only from src/lib/notification-delivery.ts', () => {
    const callers = FILES.filter(
      ({ file, text }) => file !== path.join(SRC, 'lib', 'mail.ts') && /\bsendMail\b/.test(text)
    ).map((f) => f.file)
    expect(callers).toEqual([DELIVERY])
  })
})
