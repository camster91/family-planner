// To-dos, D1 side. Rules: src/lib/list-tasks.ts; PostgreSQL twin: src/lib/list-tasks-db.ts.
import type { AssistantProofActor } from '@/lib/assistant-source-proof'
import type { EffectResult } from '@/lib/idempotency'
import { eventPersonKey } from '@/lib/event-participants'
import {
  LIST_TASKS_UNSUPPORTED, LIST_TASK_GROCERY, LIST_TASK_INVALID, isDueDay, isTaskListType, listTasksReady, nextTaskRow,
  type ListItemTaskInput, type ListItemTaskView,
} from '@/lib/list-tasks'
import { listTaskViews } from '@/lib/list-tasks-db'
import { getD1Database, type D1Store } from './database'
import { readD1HouseholdPeople } from './event-participants'
import { authorizeD1Lists } from './list-authority'
import { executeD1PersonEffect } from './person-effect'
import { d1WriteCheck } from './write-check'

type Row = { item_id: string; user_id: string | null; member_id: string | null; due_day: string | null }

/** Tasks for the given items of one household. Empty when the capability is off. */
export async function readD1ListItemTasks(familyId: string, itemIds: string[], database?: D1Store): Promise<Map<string, ListItemTaskView>> {
  if (!listTasksReady() || itemIds.length === 0) return new Map()
  const db = (database ?? await getD1Database()).withSession('first-primary')
  const rows: Row[] = []
  // Bound parameters per statement stay well under D1's limit.
  for (let start = 0; start < itemIds.length; start += 80) {
    const ids = itemIds.slice(start, start + 80)
    const found = await db.prepare(`SELECT item_id,user_id,member_id,due_day FROM "ListItemTask" WHERE family_id=?1 AND item_id IN (${ids.map((_, i) => `?${i + 2}`).join(',')})`)
      .bind(familyId, ...ids).all<Row>()
    rows.push(...found.results)
  }
  if (rows.length === 0) return new Map()
  return listTaskViews(rows, await readD1HouseholdPeople(db, familyId))
}

/** Set, change or clear one item's owner and due day. Parents and teens only, like creating a list. */
export async function setD1ListItemTask(actor: AssistantProofActor, input: ListItemTaskInput, database?: D1Store, now: Date = new Date()): Promise<EffectResult> {
  if (!listTasksReady()) return LIST_TASKS_UNSUPPORTED
  if (input.due !== undefined && input.due !== null && !isDueDay(input.due)) return LIST_TASK_INVALID
  const store = database ?? await getD1Database()
  const result = await executeD1PersonEffect({
    actor, action: 'list-item.task', input, key: null, database: store, now,
    authorize: (db) => authorizeD1Lists(db, actor, true),
    plan: async (db) => {
      const item = await db.listItem.findUnique({ where: { id: input.itemId }, select: { id: true, list_id: true } })
      const list = item ? await db.list.findFirst({ where: { id: item.list_id, family_id: actor.familyId }, select: { id: true, type: true } }) : null
      if (!item || !list) return { status: 404, body: { error: 'Item not found' } }
      if (!isTaskListType(list.type)) return LIST_TASK_GROCERY
      // The people a to-do can be for are the people an event can be for.
      const people = await readD1HouseholdPeople(store.withSession('first-primary'), actor.familyId)
      if (input.owner && !people.has(eventPersonKey(input.owner))) return LIST_TASK_INVALID
      const current = await db.listItemTask.findUnique({ where: { item_id: item.id }, select: { item_id: true, user_id: true, member_id: true, due_day: true } })
      const next = nextTaskRow(current, input)
      const view = next ? listTaskViews([{ item_id: item.id, ...next }], people).get(item.id) : undefined
      return {
        status: 200, body: { task: view ?? { owner: null, due: null } },
        effects: (session) => [
          // The item is still in this household's list when the change lands.
          d1WriteCheck(session, `EXISTS (SELECT 1 FROM "ListItem" i JOIN "List" l ON l.id=i.list_id WHERE i.id=?1 AND l.family_id=?2)`, [item.id, actor.familyId]),
          next
            ? session.prepare(`INSERT INTO "ListItemTask" (item_id,family_id,user_id,member_id,due_day,updated_at) VALUES (?1,?2,?3,?4,?5,?6)
                ON CONFLICT (item_id) DO UPDATE SET user_id=excluded.user_id,member_id=excluded.member_id,due_day=excluded.due_day,updated_at=excluded.updated_at`)
              .bind(item.id, actor.familyId, next.user_id, next.member_id, next.due_day, now.getTime())
            : session.prepare(`DELETE FROM "ListItemTask" WHERE item_id=?1 AND family_id=?2`).bind(item.id, actor.familyId),
        ],
      }
    },
  })
  return { status: result.status, body: result.body }
}
