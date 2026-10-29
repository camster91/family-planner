import {
  createD1Anniversary,
  deleteD1Anniversary,
  readD1Anniversaries,
  updateD1Anniversary,
} from '../../../src/lib/cloudflare/anniversaries'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

const parent = { userId: 'anniversary-parent', familyId: 'anniversary-family-a', role: 'parent', generation: 0 } as const
const child = { userId: 'anniversary-child', familyId: 'anniversary-family-a', role: 'child', generation: 0 } as const
const teen = { userId: 'anniversary-teen', familyId: 'anniversary-family-a', role: 'teen', generation: 0 } as const
const foreign = { userId: 'anniversary-foreign', familyId: 'anniversary-family-b', role: 'parent', generation: 0 } as const
const features = JSON.stringify({ anniversaries: true })

/** Disposable native coverage for birthdays, anniversaries and custom dates. */
export async function testAnniversaries(db: D1Store) {
  const now = Date.parse('2026-10-28T16:00:00.000Z')
  await db.batch([
    db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('anniversary-family-a','Dates A','anniversary-code-a',?1),('anniversary-family-b','Dates B','anniversary-code-b',?1)`).bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES
      ('anniversary-parent','anniversary-parent@example.test','Dates Parent','anniversary-family-a','parent',0),
      ('anniversary-child','anniversary-child@example.test','Dates Child','anniversary-family-a','child',0),
      ('anniversary-teen','anniversary-teen@example.test','Dates Teen','anniversary-family-a','teen',0),
      ('anniversary-foreign','anniversary-foreign@example.test','Other Parent','anniversary-family-b','parent',0)`),
    db.prepare(`INSERT INTO "Anniversary"(id,family_id,name,type,date,notes,person_id,created_by,created_at) VALUES
      ('anniversary-existing','anniversary-family-a','Child birthday','birthday',?1,'Family party','anniversary-child','anniversary-parent',?2),
      ('anniversary-foreign-row','anniversary-family-b','Private date','custom',?1,NULL,'anniversary-foreign','anniversary-foreign',?2)`).bind(Date.parse('2026-11-01T00:00:00.000Z'), now),
  ])

  const listed = await readD1Anniversaries(parent, db)
  check(listed.status === 200 && (listed.body as any).dates.length === 1, 'dates stay in household')
  const foreignListed = await readD1Anniversaries(foreign, db)
  check(foreignListed.status === 200 && (foreignListed.body as any).dates.length === 1, 'foreign dates stay isolated')
  const childListed = await readD1Anniversaries(child, db)
  check(childListed.status === 200 && (childListed.body as any).dates[0].can_edit === false && (childListed.body as any).dates[0].can_delete === false, 'child permissions are projected')

  const input = { name: 'Teen birthday', type: 'birthday', date: '2026-12-15', notes: 'Small party', person_id: teen.userId }
  const created = await createD1Anniversary(child, input, 'anniversary-create-key', db)
  check(created.status === 201 && (created.body as any).date.family_id === child.familyId && (created.body as any).date.created_by === child.userId, 'child creates a date')
  const replay = await createD1Anniversary(child, input, 'anniversary-create-key', db)
  check(replay.replayed && JSON.stringify(replay.body) === JSON.stringify(created.body), 'date create replay')
  const id = (created.body as any).date.id as string
  check((await updateD1Anniversary(child, id, { name: 'Teen birthday updated' }, 'anniversary-update-key', db)).status === 200, 'creator can update date')
  check((await updateD1Anniversary(child, 'anniversary-existing', { name: 'No' }, null, db)).status === 403, 'child cannot edit parent date')
  check((await updateD1Anniversary(foreign, id, { name: 'No' }, null, db)).status === 404, 'foreign date is hidden')
  check((await deleteD1Anniversary(child, id, 'anniversary-delete-key', db)).status === 403, 'child cannot delete date')
  check((await deleteD1Anniversary(parent, id, 'anniversary-delete-key', db)).status === 200, 'parent deletes date')
  check((await deleteD1Anniversary(parent, id, 'anniversary-delete-key', db)).replayed, 'delete replay after removal')

  return { read: true, create: true, update: true, delete: true, receipts: true, ownership: true, householdIsolation: true }
}
