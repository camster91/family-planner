// To-dos, PostgreSQL side. Rules: src/lib/list-tasks.ts; D1 twin: src/lib/cloudflare/list-tasks.ts.
import type { PrismaClient } from '@prisma/client'
import type { EffectResult } from '@/lib/idempotency'
import { eventPersonKey, type EventPerson } from '@/lib/event-participants'
import { readHouseholdPeople } from '@/lib/event-participants-db'
import { authorizePersonListItemInTx, type PersonListItemActor } from '@/lib/person-list-item-authority'
import {
  LIST_TASKS_UNSUPPORTED, LIST_TASK_GROCERY, LIST_TASK_INVALID, isDueDay, isTaskListType, listTasksReady, nextTaskRow,
  type ListItemTaskInput, type ListItemTaskView,
} from '@/lib/list-tasks'

type Row = { item_id: string; user_id: string | null; member_id: string | null; due_day: string | null }
/** The view of stored rows: an owner who has left or been archived no longer shows, as on events. */
export function listTaskViews(rows: Row[], people: Map<string, EventPerson>): Map<string, ListItemTaskView> {
  const out = new Map<string, ListItemTaskView>()
  for (const row of rows) {
    const owner = row.user_id !== null ? people.get(eventPersonKey({ kind: 'account', id: row.user_id }))
      : row.member_id !== null ? people.get(eventPersonKey({ kind: 'profile', id: row.member_id })) : undefined
    if (owner || row.due_day) out.set(row.item_id, { owner: owner ?? null, due: row.due_day })
  }
  return out
}

/** Tasks for the given items of one household. Empty when the capability is off. */
export async function readListItemTasks(db: Pick<PrismaClient, 'listItemTask' | 'user' | 'householdMember'>, familyId: string, itemIds: string[]) {
  if (!listTasksReady() || itemIds.length === 0) return new Map<string, ListItemTaskView>()
  const rows = await db.listItemTask.findMany({ where: { family_id: familyId, item_id: { in: itemIds } },
    select: { item_id: true, user_id: true, member_id: true, due_day: true } })
  if (rows.length === 0) return new Map<string, ListItemTaskView>()
  return listTaskViews(rows, await readHouseholdPeople(db, familyId))
}

/** Set, change or clear one item's owner and due day. Parents and teens only, like creating a list. */
export async function setListItemTask(db: Pick<PrismaClient, '$transaction'>, actor: PersonListItemActor, input: ListItemTaskInput, now: Date = new Date()): Promise<EffectResult> {
  if (!listTasksReady()) return LIST_TASKS_UNSUPPORTED
  if (input.due !== undefined && input.due !== null && !isDueDay(input.due)) return LIST_TASK_INVALID
  return db.$transaction(async (tx) => {
    const refused = await authorizePersonListItemInTx(tx, actor, { requireListCreation: true })
    if (refused) return refused
    const item = await tx.listItem.findFirst({ where: { id: input.itemId, list: { family_id: actor.familyId } }, select: { id: true, list: { select: { type: true } } } })
    if (!item) return { status: 404, body: { error: 'Item not found' } }
    if (!isTaskListType(item.list.type)) return LIST_TASK_GROCERY
    const people = await readHouseholdPeople(tx, actor.familyId)
    if (input.owner && !people.has(eventPersonKey(input.owner))) return LIST_TASK_INVALID
    const current = await tx.listItemTask.findUnique({ where: { item_id: item.id }, select: { item_id: true, user_id: true, member_id: true, due_day: true } })
    const next = nextTaskRow(current, input)
    if (!next) await tx.listItemTask.deleteMany({ where: { item_id: item.id, family_id: actor.familyId } })
    else await tx.listItemTask.upsert({ where: { item_id: item.id }, create: { item_id: item.id, family_id: actor.familyId, ...next, updated_at: now }, update: { ...next, updated_at: now } })
    const view = next ? listTaskViews([{ item_id: item.id, ...next }], people).get(item.id) : undefined
    return { status: 200, body: { task: view ?? { owner: null, due: null } } }
  })
}
