import { deliverD1Notification } from '../../../src/lib/cloudflare/notification-delivery'
import { readD1NotificationInbox, mutateD1NotificationInbox } from '../../../src/lib/cloudflare/notification-inbox'
import type { D1Store } from '../../../src/lib/cloudflare/database'
import { encodeNotificationCursor, parseNotificationPaging, afterNotificationCursor } from '../../../src/lib/notification-paging'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
export async function testNotificationInbox(db: D1Store) {
  const now = new Date('2026-10-28T02:00:00Z')
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code) VALUES ('inbox-a','Inbox fixture','inbox-a'),('inbox-b','Other','inbox-b')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,quiet_hours_enabled,quiet_hours_time_zone) VALUES ('inbox-parent','inbox-parent@example.test','Parent','inbox-a','parent',0,NULL),('inbox-teen','inbox-teen@example.test','Teen','inbox-a','teen',1,'UTC'),('inbox-sibling','inbox-sibling@example.test','Sibling','inbox-a','child',0,NULL),('inbox-other','inbox-other@example.test','Other','inbox-b','parent',0,NULL),('inbox-unattached','inbox-unattached@example.test','Unattached',NULL,'parent',0,NULL)`).run()
  const input = { userId: 'inbox-teen', familyId: 'inbox-a', senderId: 'inbox-parent', senderContext: { role: 'parent', tokenVersion: 0 }, title: 'Fixture reminder', message: 'Fabricated details', type: 'chore' as const, actionUrl: '/dashboard/chores' }
  const teen = { userId: 'inbox-teen', generation: 0 }, sibling = { userId: 'inbox-sibling', generation: 0 }
  const delivered = await deliverD1Notification(input, now, db)
  check(delivered.delivered && delivered.quiet && delivered.notification.action_url === input.actionUrl && !delivered.notification.read, 'quiet notice retained with canonical output')
  const id = delivered.notification.id
  const count = async () => (await db.prepare(`SELECT count(*) AS n FROM "Notification" WHERE user_id='inbox-teen'`).first<{ n: number }>())!.n
  await db.prepare(`UPDATE "User" SET notify_chores=0,notify_events=0,notify_messages=0 WHERE id='inbox-teen'`).run()
  for (const type of ['chore','reward','event','message'] as const) check(!(await deliverD1Notification({ ...input, type }, now, db)).delivered, 'muted category '+type)
  check(await count() === 1, 'muted categories store nothing')
  check((await deliverD1Notification({ ...input, type: 'system' }, now, db)).delivered, 'always notice ignores category mute')
  check(!(await deliverD1Notification({ ...input, type: 'summary' }, now, db)).delivered, 'summary explicit opt in')
  await db.prepare(`UPDATE "User" SET morning_summary_enabled=1 WHERE id='inbox-teen'`).run()
  check((await deliverD1Notification({ ...input, type: 'summary', recipientContext: { role: 'teen', tokenVersion: 0 } }, now, db)).delivered, 'current summary owner admitted')
  for (const bad of [
    { ...input, familyId: 'inbox-b' }, { ...input, senderId: 'inbox-other' }, { ...input, senderId: 'inbox-sibling' },
    { ...input, senderContext: { role: 'parent', tokenVersion: 1 } }, { ...input, recipientContext: { role: 'parent', tokenVersion: 0 } },
    { ...input, recipientContext: { role: 'teen', tokenVersion: 1 } }, { ...input, userId: 'missing' },
  ]) check(!(await deliverD1Notification({ ...bad, type: 'system' }, now, db)).delivered, 'foreign/missing/stale participant refused')
  check((await deliverD1Notification({ userId: 'inbox-unattached', title: 'Account notice', message: 'Fixture', type: 'system' }, now, db)).delivered, 'unattached legacy account notice')
  check((await mutateD1NotificationInbox(sibling, { kind: 'read', id }, db)).status === 404, 'sibling mark refused')
  check((await mutateD1NotificationInbox(sibling, { kind: 'delete', id }, db)).status === 404, 'sibling deletion refused')
  check((await mutateD1NotificationInbox(sibling, { kind: 'snooze', id, until: now }, db)).status === 404, 'sibling snooze refused')
  check((await mutateD1NotificationInbox(teen, { kind: 'read', id }, db)).status === 200, 'own mark read')
  const until = new Date(now.getTime() + 3600000)
  check((await mutateD1NotificationInbox(teen, { kind: 'snooze', id, until }, db)).status === 200, 'own snooze')
  const state = await db.prepare(`SELECT read,snoozed_until FROM "Notification" WHERE id=?1`).bind(id).first<{ read: number; snoozed_until: number }>()
  check(state?.read === 0 && state.snoozed_until === until.getTime(), 'snooze reopens unread and stores exact instant')
  const page = await readD1NotificationInbox(teen, { OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }] }, 50, db)
  check(page.status === 200 && Array.isArray(page.body) && !page.body.some(row => row.id === id), 'snooze excluded from active inbox')
  check((await mutateD1NotificationInbox(teen, { kind: 'snooze', id, until: null }, db)).status === 200, 'unsnooze clears instant')
  await db.prepare(`INSERT INTO "Notification"(id,user_id,title,message,type,created_at) SELECT value,'inbox-teen','Paged fixture','Fixture','system',?2 FROM json_each(?1)`).bind(JSON.stringify(Array.from({length:70},(_,i)=>'inbox-page-'+i.toString().padStart(2,'0'))), now.getTime()).run()
  const scope = { userId: teen.userId, unreadOnly: false, includeSnoozed: true }
  const first = await readD1NotificationInbox(teen, {}, 51, db)
  check(first.status === 200 && Array.isArray(first.body) && first.body.length === 51, 'bounded inbox page')
  const firstRows = first.body
  const maxPage = await readD1NotificationInbox(teen, {}, 101, db)
  check(maxPage.status === 200 && Array.isArray(maxPage.body) && maxPage.body.length === 73, 'legacy maximum page size retained')
  const cursor = encodeNotificationCursor(scope, firstRows[49]), parsed = parseNotificationPaging(new URLSearchParams({limit:'50',cursor}), scope)
  check(parsed.ok && parsed.paged && parsed.cursor, 'scoped cursor decodes')
  const second = await readD1NotificationInbox(teen, afterNotificationCursor(parsed.cursor), 51, db)
  check(second.status === 200 && Array.isArray(second.body) && second.body.length === 23 && !second.body.some(row => firstRows.slice(0,50).some(prior => prior.id === row.id)), 'keyset ties continue without duplicates')
  check((await mutateD1NotificationInbox(teen, { kind: 'read-all' }, db)).status === 200, 'mark all read')
  check((await db.prepare(`SELECT count(*) AS n FROM "Notification" WHERE user_id='inbox-teen' AND read=0`).first<{n:number}>())!.n === 0, 'all own read')
  const racing = (sql: string): D1Store => ({ prepare: db.prepare.bind(db), batch: db.batch.bind(db), withSession() {
    const native = db.withSession('first-primary'); let changed = false
    return { prepare: native.prepare.bind(native), async batch(statements) { if (!changed) { changed = true; await db.prepare(sql).run() } return native.batch(statements) } }
  } })
  check(!(await deliverD1Notification({ ...input, type: 'system' }, now, racing(`UPDATE "User" SET family_id='inbox-b' WHERE id='inbox-teen'`))).delivered, 'recipient moving at commit refused')
  check(await count() === 73, 'recipient move creates nothing')
  await db.prepare(`UPDATE "User" SET family_id='inbox-a' WHERE id='inbox-teen'`).run()
  check(!(await deliverD1Notification({ ...input, type: 'system' }, now, racing(`UPDATE "User" SET role='teen' WHERE id='inbox-parent'`))).delivered, 'sender role at commit renewed')
  await db.prepare(`UPDATE "User" SET role='parent' WHERE id='inbox-parent'`).run()
  await db.prepare(`UPDATE "User" SET notify_chores=1 WHERE id='inbox-teen'`).run()
  check(!(await deliverD1Notification(input, now, racing(`UPDATE "User" SET notify_chores=0 WHERE id='inbox-teen'`))).delivered, 'mute at commit suppresses')
  check((await mutateD1NotificationInbox(teen, { kind: 'delete-all' }, racing(`UPDATE "User" SET token_version=1 WHERE id='inbox-teen'`))).status === 401 && await count() === 73, 'revoked bulk delete has no effect')
  check((await readD1NotificationInbox(teen, {}, 50, db)).status === 401, 'revoked inbox read refused')
  await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='inbox-teen'`).run()
  await db.prepare(`CREATE TRIGGER inbox_force_failure BEFORE INSERT ON "Notification" WHEN NEW.title='Force failure' BEGIN SELECT RAISE(ABORT,'forced notification failure'); END`).run()
  let failed = false
  try { await deliverD1Notification({ ...input, type: 'system', title: 'Force failure' }, now, db) } catch { failed = true }
  finally { await db.prepare(`DROP TRIGGER inbox_force_failure`).run() }
  check(failed && await count() === 73, 'native insertion failure leaves no partial delivery')
  const siblingNotice = await deliverD1Notification({ ...input, userId: sibling.userId, type: 'system' }, now, db)
  check(siblingNotice.delivered && !siblingNotice.quiet, 'quiet hours belong to recipient')
  await db.prepare(`INSERT INTO "NotificationEventOccurrence"(id,family_id,occurrence_key,envelope) VALUES ('inbox-event','inbox-a',?1,'{}')`).bind('a'.repeat(64)).run()
  await db.prepare(`INSERT INTO "NotificationRecipientDecision"(id,family_id,event_id,slot,user_id,notification_id,status,quiet) VALUES ('inbox-decision','inbox-a','inbox-event',0,'inbox-teen',?1,'created',1)`).bind(id).run()
  const refuses = async (sql: string) => { try { await db.prepare(sql).run(); return false } catch { return true } }
  check(await refuses(`UPDATE "NotificationEventOccurrence" SET envelope='{"changed":true}' WHERE id='inbox-event'`), 'occurrence content immutable')
  check(await refuses(`INSERT INTO "NotificationEventOccurrence"(id,family_id,occurrence_key,envelope) VALUES ('inbox-invalid','inbox-a','invalid','{}')`), 'occurrence key shape')
  check(await refuses(`INSERT INTO "NotificationRecipientDecision"(id,family_id,event_id,slot,status,quiet) VALUES ('inbox-invalid','inbox-a','inbox-event',100,'suppressed',1)`), 'recipient slot bound')
  check(await refuses(`UPDATE "NotificationRecipientDecision" SET status='suppressed' WHERE id='inbox-decision'`), 'terminal status immutable')
  check((await mutateD1NotificationInbox(teen, { kind: 'delete', id }, db)).status === 200 && (await mutateD1NotificationInbox(teen, { kind: 'delete', id }, db)).status === 404, 'own exact delete and repeat')
  check((await db.prepare(`SELECT notification_id FROM "NotificationRecipientDecision" WHERE id='inbox-decision'`).first<{notification_id:string|null}>())?.notification_id === null, 'inbox deletion clears evidence link')
  check(await refuses(`UPDATE "NotificationRecipientDecision" SET notification_id='${siblingNotice.notification.id}' WHERE id='inbox-decision'`), 'deleted slot cannot adopt new notice')
  check((await mutateD1NotificationInbox(teen, { kind: 'delete-all' }, db)).status === 200 && await count() === 0, 'own clear all')
  check((await db.prepare(`SELECT count(*) AS n FROM "Notification" WHERE user_id='inbox-sibling'`).first<{n:number}>())!.n === 1, 'clear preserves other inbox')
  return { categories: 4, alwaysAndOptIn: true, quiet: true, accountNotice: true, scopedPaging: 73, ownReadSnoozeDelete: true, commitMembershipRoleMuteRaces: true, revokedBulkWrite: true, rollback: true, terminalEvidence: true }
}
