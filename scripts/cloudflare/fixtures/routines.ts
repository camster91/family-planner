import { expandD1RecurringSeries } from "../../../src/lib/cloudflare/recurring-chores"
import { readD1IndependentRoutine, saveD1IndependentRoutine } from '../../../src/lib/cloudflare/routine-independent'
import { readD1RoutineSchedule, saveD1RoutineSchedule } from '../../../src/lib/cloudflare/routine-schedule'
import { readD1RoutineStack, saveD1RoutineStack } from '../../../src/lib/cloudflare/routine-stack'
import { routineStepSeriesConfig } from '../../../src/lib/routine-schedule'
import type { D1Store } from '../../../src/lib/cloudflare/database'

function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }

/** Focused native routine smoke. The caller owns the disposable D1 database. */
export async function testRoutines(db: D1Store) {
  const day = '2026-10-28'
  const now = new Date(`${day}T16:00:00.000Z`)
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('routine-a','Routine fixture','routine-a','{"chores":true,"gamification":true}'),('routine-b','Foreign routine fixture','routine-b','{"chores":true}')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role,token_version) VALUES ('routine-parent','routine-parent@example.test','Routine Parent','routine-a','parent',0),('routine-foreign','routine-foreign@example.test','Foreign Parent','routine-b','parent',0)`).run()

  const subject = { kind: 'account' as const, user_id: 'routine-parent', member_id: null }
  const schedule = { frequency: 'daily' as const, starts_on: day, weekly_days: [], monthly_day: null }
  const definition = routineStepSeriesConfig.parse({
    protocol: 'herewoven.routine-step-series.v1', revision: 1, once_pending: false,
    anchor_retired: false, stack_id: null, state: 'active', effective_on: day,
    anchor: 'After breakfast', schedule,
    content: { title: 'Detached routine', description: null, subject, points: 5, difficulty: 'easy', icon: null, duration_minutes: 5 },
  })
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,description,points,created_by,assigned_to,due_date,frequency,recurrence_id,is_template,routine_series_config) VALUES ('routine-independent-root','routine-a','Detached routine',NULL,5,'routine-parent','routine-parent',?1,'daily','routine-independent-root',1,?2)`).bind(Date.parse(`${day}T00:00:00.000Z`), JSON.stringify(definition)).run()
  const parent = { userId: 'routine-parent', familyId: 'routine-a', role: 'parent', tokenVersion: 0, memberProtocol: 2 as const }
  const foreign = { ...parent, userId: 'routine-foreign', familyId: 'routine-b' }
  const state = await readD1IndependentRoutine(parent, 'routine-independent-root', db)
  check(state.status === 200, 'independent routine read')
  check((state.body as { pointsEnabled: boolean; content?: { points?: number } }).pointsEnabled === true, 'independent points capability')
  check((await readD1IndependentRoutine(foreign, 'routine-independent-root', db)).status === 404, 'foreign routine is private')

  const command = { protocol: 'herewoven.routine-independent.v1', action: 'pause' as const, expected_user_id: parent.userId, expected_family_id: parent.familyId, issued_at: now.toISOString(), view_day: day, view_zone: 'UTC', root_id: 'routine-independent-root', expected_revision: 1, scope: 'future-after-today' as const }
  const paused = await saveD1IndependentRoutine(parent, command, 'routine-independent-pause-1', now, db, true)
  check(paused.status === 200, 'independent routine pause')
  check((await saveD1IndependentRoutine(parent, command, 'routine-independent-pause-1', now, db, true)).status === 200, 'independent receipt replay')
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='routine-parent'`).run()
  check((await saveD1IndependentRoutine(parent, command, 'routine-independent-pause-1', now, db, true)).status === 403, 'revoked session cannot replay routine receipt')
  await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='routine-parent'`).run()

  const scheduleInput = { protocol: 'herewoven.routine-schedule.v1', action: 'create' as const, expected_user_id: parent.userId, expected_family_id: parent.familyId, issued_at: now.toISOString(), view_day: day, view_zone: 'UTC', label: 'Morning routine', anchor: 'After breakfast', schedule: { frequency: 'daily' as const, starts_on: day, weekly_days: [], monthly_day: null }, steps: [{ client_step_id: 'morning-step', template_id: null, title: 'Brush teeth', description: null, subject, points: 5, difficulty: 'easy' as const, icon: null, duration_minutes: 3 }] }
  const created = await saveD1RoutineSchedule(parent, scheduleInput, 'routine-schedule-create-1', now, db, true)
  check(created.status === 201, 'future routine schedule create')
  const stackId = String((created.body as { stackId: string }).stackId)
  check((await readD1RoutineSchedule(parent, stackId, db)).status === 200, 'future routine schedule read')
  check((await saveD1RoutineSchedule(parent, scheduleInput, 'routine-schedule-create-1', now, db, true)).status === 201, 'future schedule receipt replay')
  await db.prepare(`UPDATE "Family" SET features='{"chores":true}' WHERE id='routine-a'`).run()
  const hiddenIndependent = await readD1IndependentRoutine(parent, 'routine-independent-root', db)
  check(hiddenIndependent.status === 200 && (hiddenIndependent.body as { pointsEnabled: boolean; content?: { points?: number } }).pointsEnabled === false && !(hiddenIndependent.body as { content?: { points?: number } }).content?.points, 'independent points stay private when disabled')
  const hiddenSchedule = await readD1RoutineSchedule(parent, stackId, db)
  check(hiddenSchedule.status === 200 && (hiddenSchedule.body as { pointsEnabled: boolean; steps?: Array<{ points?: number }> }).pointsEnabled === false && !(hiddenSchedule.body as { steps?: Array<{ points?: number }> }).steps?.some((step) => step.points !== undefined), 'schedule points stay private when disabled')
  await db.prepare(`UPDATE "Family" SET features='{"chores":true,"gamification":true}' WHERE id='routine-a'`).run()

  const stackDraft = { family_id: parent.familyId, stack_id: null, occurrence_date: day, label: 'Bedtime steps', steps: [{ title: 'Put pajamas away', description: null, assigned_to: parent.userId, assigned_member_id: null, due_date: day, frequency: 'once' as const, weekly_days: [], difficulty: 'easy' as const, icon: null, routine: null, routine_order: 1, recurrence_id: null, is_template: false }], remove_chore_ids: [], expected_fingerprint: '' }
  const stackResults = await Promise.all(Array.from({ length: 4 }, () => saveD1RoutineStack(parent, stackDraft, 'routine-stack-create-1', now, db)))
  check(stackResults.every((result) => result.status === 200), 'concurrent routine stack writes converge')
  const stack = stackResults[0]
  check(stack.status === 200, 'current routine stack create')
  const currentStackId = String((stack.body as { stack_id: string }).stack_id)
  check((await readD1RoutineStack(parent, currentStackId, day, db))?.status === 200, 'current routine stack read')
  check((await saveD1RoutineStack(parent, stackDraft, 'routine-stack-create-1', now, db)).status === 200, 'current routine stack receipt replay')

  // Profile-backed repeating work must use canonical member identity rather
  // than inventing an account, and expansion must stop when that profile ends.
  const flagNames=['HOUSEHOLD_PROFILE_CHORE_ENABLED','HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY','HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED','ROUTINE_SCHEDULE_ENABLED','ROUTINE_SCHEDULE_ROLLBACK_READY']
  const previous=flagNames.map(name=>process.env[name])
  try {
    flagNames.forEach(name=>{process.env[name]='1'})
    await db.prepare(`INSERT INTO HouseholdMember(id,family_id,name,role,age) VALUES ('routine-profile','routine-a','Small child','child',3),('routine-other-profile','routine-b','Private child','child',4)`).run()
    const profileInput={...scheduleInput,label:'Family evening',steps:[{...scheduleInput.steps[0],client_step_id:'profile-step',subject:{kind:'profile' as const,member_id:'routine-profile'}},{...scheduleInput.steps[0],client_step_id:'parent-step',title:'Prepare tomorrow bags'}]}
    const profileCreated=await saveD1RoutineSchedule(parent,profileInput,'routine-profile-create-1',now,db,true)
    check(profileCreated.status===201,'mixed account and email-free profile routine saves')
    const profileStack=String((profileCreated.body as {stackId:string}).stackId)
    const root=await db.prepare(`SELECT id,assigned_to FROM Chore WHERE routine_stack_id=? AND assigned_member_id='routine-profile' AND is_template=1`).bind(profileStack).first<{id:string,assigned_to:string|null}>()
    check(root&&root.assigned_to===null,'profile routine root does not impersonate an account')
    await expandD1RecurringSeries(root.id,parent.familyId,now,db)
    const occurrences=await db.prepare(`SELECT id,assigned_to,assigned_member_id,status FROM Chore WHERE recurrence_id=? AND id<>? ORDER BY due_date`).bind(root.id,root.id).all<{id:string,assigned_to:string|null,assigned_member_id:string,status:string}>()
    check(!!occurrences.results?.length&&occurrences.results.every(row=>row.assigned_to===null&&row.assigned_member_id==='routine-profile'&&row.status==='pending'),'profile recurrence produces assigned pending canonical chores')
    const count=occurrences.results.length
    await expandD1RecurringSeries(root.id,parent.familyId,now,db)
    check((await db.prepare(`SELECT COUNT(*) AS count FROM Chore WHERE recurrence_id=? AND id<>?`).bind(root.id,root.id).first<{count:number}>())?.count===count,'profile recurrence expansion is duplicate-safe')
    const foreignProfile=await saveD1RoutineSchedule(parent,{...profileInput,steps:[{...profileInput.steps[0],subject:{kind:'profile',member_id:'routine-other-profile'}}]},'routine-profile-foreign-1',now,db,true)
    check(foreignProfile.status>=400,'routine cannot assign a foreign household profile')
    await db.prepare(`UPDATE HouseholdMember SET archived_at=? WHERE id='routine-profile'`).bind(+now).run()
    check(await expandD1RecurringSeries(root.id,parent.familyId,new Date(+now+14*86400000),db)===0,'archived profile does not generate future work')
  } finally {
    flagNames.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index]})
  }

  return { mixedProfileRoutine:true, profileRecurrence:true, profileIsolation:true, profileArchiveStopsExpansion:true, independent: true, independentReplay: true, revokedReplayDenied: true, schedule: true, scheduleReplay: true, stack: true, stackReplay: true }
}
