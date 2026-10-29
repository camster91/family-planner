import type { D1Store } from '../../../src/lib/cloudflare/database'
import { markD1MessagesRead, readD1Messages, sendD1Message } from '../../../src/lib/cloudflare/messages'
import { parseMessagePaging } from '../../../src/lib/message-paging'
import type { MessageWriteBody } from '../../../src/lib/message-mutations'

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const actor = {
  userId: 'message-parent',
  familyId: 'message-family-a',
  role: 'parent',
  generation: 0,
} as const

/** Disposable D1 coverage for ordinary household chat and private claims. */
export async function testMessages(db: D1Store) {
  const now = Date.now()
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES
    ('message-family-a','Message A','message-a','{"messages":true}'),
    ('message-family-b','Message B','message-b','{"messages":true}')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,email_verified,token_version) VALUES
    ('message-parent','message-parent@example.test','Message Parent','message-family-a','parent',1,0),
    ('message-child','message-child@example.test','Message Child','message-family-a','child',1,0),
    ('message-other','message-other@example.test','Other Parent','message-family-b','parent',1,0)`).run()
  await db.prepare(`INSERT INTO "Pickup"(id,family_id,title,pickup_time,assigned_to,created_by,completed,created_at,updated_at) VALUES
    ('message-pickup-a','message-family-a','School pickup',?1,'message-child','message-parent',0,?2,?2),
    ('message-pickup-b','message-family-b','Foreign pickup',?1,'message-other','message-other',0,?2,?2)`).bind(now + 3600000, now).run()
  await db.prepare(`INSERT INTO "Message"(id,family_id,sender_id,content,type,attachments,read_by,pickup_id,created_at) VALUES
    ('message-old','message-family-a','message-child','Older note','text','[]','["message-child"]','message-pickup-a',?1),
    ('message-middle','message-family-a','message-child','Middle note','text','[]','[]',NULL,?2),
    ('message-new','message-family-a','message-parent','Newer note','announcement','[]','["message-parent"]',NULL,?3),
    ('message-foreign','message-family-b','message-other','Private note','text','[]','[]',NULL,?3)`).bind(now - 2000, now - 1500, now - 1000).run()
  await db.prepare(`INSERT INTO "MessageAttachment"(id,family_id,uploaded_by,message_id,filename,content_type,size_bytes,created_at) VALUES
    ('message-draft-a','message-family-a','message-parent',NULL,'11111111111111111111111111111111.png','image/png',4,?1),
    ('message-draft-b','message-family-b','message-other',NULL,'22222222222222222222222222222222.png','image/png',4,?1)`).bind(now).run()

  const first = await readD1Messages(actor, {
    modern: true,
    limit: 2,
    cursor: null,
    paging: { ok: true, limit: 2, cursor: null },
  }, db)
  const firstBody = first.body as any
  check(first.status === 200 && firstBody.messages.length === 2 && firstBody.nextCursor, 'modern message page and continuation')
  check(firstBody.messages.map((message: any) => message.id).join(',') === 'message-middle,message-new', 'chronological multi-row message page')
  check(firstBody.messages[1].sender.name === 'Message Parent', 'newest message projection')
  check(firstBody.messages[0].family_id === actor.familyId && firstBody.members.length === 2, 'message household isolation')

  const parsed = parseMessagePaging(new URLSearchParams({ paging: 'keyset-v1', limit: '2', cursor: firstBody.nextCursor }), actor.familyId)
  check(parsed.ok, 'message continuation parses')
  const second = await readD1Messages(actor, { modern: true, limit: parsed.limit, cursor: null, paging: parsed }, db)
  const secondBody = second.body as any
  check(second.status === 200 && secondBody.messages.length === 1 && secondBody.messages[0].id === 'message-old', 'message continuation advances')
  check(secondBody.messages[0].pickup.assignee.name === 'Message Child', 'pickup stays household-scoped')
  const traversedIds = [...firstBody.messages, ...secondBody.messages].map((message: any) => message.id)
  check(new Set(traversedIds).size === 3 && traversedIds.length === 3, 'message continuation has no repeats')

  const legacy = await readD1Messages(actor, { modern: false, limit: 10, cursor: null, paging: null }, db)
  check(legacy.status === 200 && (legacy.body as any).messages.length === 3 && !(legacy.body as any).nextCursor, 'legacy message response remains compatible')

  const marked = await markD1MessagesRead(actor, { messageIds: ['message-old', 'message-old'] }, db)
  check(marked.status === 200, 'selected message read marker')
  const markedRow = await db.prepare(`SELECT read_by FROM "Message" WHERE id='message-old'`).first<{ read_by: string }>()
  check(JSON.parse(markedRow!.read_by).filter((id: string) => id === actor.userId).length === 1, 'read marker is idempotent')
  check((await markD1MessagesRead(actor, { messageIds: Array.from({ length: 1000 }, (_, index) => `missing-${index}`) }, db)).status === 200, 'large selected read marker stays within D1 bind limits')
  check((await markD1MessagesRead(actor, { markAll: true }, db)).status === 200, 'mark all messages read')

  const body: MessageWriteBody = {
    issued_at: new Date(now).toISOString(),
    content: 'Photo and pickup update',
    type: 'text',
    pickup_id: 'message-pickup-a',
    attachment_ids: ['message-draft-a'],
    expected_user_id: actor.userId,
    expected_family_id: actor.familyId,
    expected_generation: actor.generation,
  }
  const sent = await sendD1Message(actor, body, 'message-fixture-key-001', db, new Date(now))
  check(sent.status === 200 && (sent.body as any).message.attachments[0].endsWith('/message-draft-a'), 'message send claims attachment')
  const replay = await sendD1Message(actor, body, 'message-fixture-key-001', db, new Date(now + 1000))
  check(replay.replayed === true && JSON.stringify(replay.body) === JSON.stringify(sent.body), 'message send receipt replay')
  const claimed = await db.prepare(`SELECT message_id FROM "MessageAttachment" WHERE id='message-draft-a'`).first<{ message_id: string | null }>()
  check(claimed?.message_id === (sent.body as any).message.id, 'attachment claim is atomic')

  const foreignAttachment = await sendD1Message(actor, { ...body, attachment_ids: ['message-draft-b'], content: 'No foreign file' }, 'message-fixture-foreign-001', db, new Date(now + 1000))
  check(foreignAttachment.status === 404, 'foreign attachment ownership refused')
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='message-parent'`).run()
  const revokedReplay = await sendD1Message(actor, body, 'message-fixture-key-001', db, new Date(now + 2000))
  check(revokedReplay.status === 401, 'receipt replay rechecks current session authority')

  return { history: true, legacy: true, householdIsolation: true, readMarkers: true, send: true, attachmentClaim: true, receiptAuthority: true }
}
