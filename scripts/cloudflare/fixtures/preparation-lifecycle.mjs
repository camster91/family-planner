import assert from 'node:assert/strict'
/** Real isolated D1 checks; no readiness flag or production connection. */
export async function checkPreparationLifecycle(db) {
  const run = sql => db.prepare(sql).run()
  const value = async (table, column, id) => (await db.prepare(`SELECT ${column} AS value FROM "${table}" WHERE id=?1`).bind(id).first())?.value
  await run(`INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES ('guard-event','schema-a','Fixture event',1,2,'schema-user')`)
  await run(`INSERT INTO "Chore"(id,family_id,title,due_date,created_by,assigned_to) VALUES ('guard-chore','schema-a','Fixture task',1,'schema-user','schema-user')`)
  const addPlan = () => run(`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES ('guard-plan','schema-a','guard-event','${'a'.repeat(64)}')`)
  const addStep = () => run(`INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position) VALUES ('guard-step','schema-a','guard-plan','guard-chore',1)`)
  await assert.rejects(db.batch([
    db.prepare(`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES ('guard-rollback','schema-a','guard-event','${'a'.repeat(64)}')`),
    db.prepare(`UPDATE "EventPreparation" SET reviewed_event_source='invalid' WHERE id='guard-rollback'`),
  ]))
  assert.equal(await value('Event','preparation_epoch','guard-event'),0,'failed batch rolls back lifecycle change')
  assert.equal(await value('EventPreparation','id','guard-rollback'),undefined)
  await addPlan()
  assert.equal(await value('Event','preparation_epoch','guard-event'),1)
  await addStep()
  assert.equal(await value('EventPreparation','revision','guard-plan'),1)
  await run(`UPDATE "EventPreparationStep" SET cue_anchor='start',cue_direction='before',cue_minutes=10 WHERE id='guard-step'`)
  assert.equal(await value('EventPreparation','revision','guard-plan'),2)
  await run(`UPDATE "EventPreparationStep" SET cue_minutes=10 WHERE id='guard-step'`)
  assert.equal(await value('EventPreparation','revision','guard-plan'),2,'no-op does not advance revision')
  for (const sql of [
    `UPDATE "EventPreparation" SET id='changed' WHERE id='guard-plan'`,
    `UPDATE "EventPreparation" SET family_id='schema-b' WHERE id='guard-plan'`,
    `UPDATE "EventPreparation" SET event_id='changed' WHERE id='guard-plan'`,
    `UPDATE "EventPreparation" SET revision=0 WHERE id='guard-plan'`,
    `UPDATE "EventPreparation" SET reviewed_event_source='invalid' WHERE id='guard-plan'`,
    `UPDATE "EventPreparation" SET revision=2147483648 WHERE id='guard-plan'`,
    `UPDATE "EventPreparationStep" SET chore_id='schema-chore' WHERE id='guard-step'`,
    `UPDATE "EventPreparationStep" SET preparation_id='changed' WHERE id='guard-step'`,
    `UPDATE "EventPreparationStep" SET family_id='schema-b' WHERE id='guard-step'`,
  ]) await assert.rejects(run(sql))
  await run(`UPDATE "EventPreparation" SET reviewed_event_source='${'b'.repeat(64)}' WHERE id='guard-plan'`)
  assert.equal(await value('EventPreparation','revision','guard-plan'),3)
  await run(`DELETE FROM "EventPreparationStep" WHERE id='guard-step'`)
  assert.equal(await value('EventPreparation','revision','guard-plan'),3,'step deletion preserves parent version contract')
  await addStep()
  assert.equal(await value('EventPreparation','revision','guard-plan'),4,'same membership recreated invalidates old snapshot')
  await run(`UPDATE "Chore" SET status='completed' WHERE id='guard-chore'`)
  await run(`UPDATE "Chore" SET status='pending' WHERE id='guard-chore'`)
  assert.equal(await value('Chore','preparation_epoch','guard-chore'),2,'completion away/back invalidates source')
  await run(`UPDATE "Chore" SET id='guard-chore-moved' WHERE id='guard-chore'`)
  assert.equal(await value('EventPreparationStep','id','guard-step'),undefined,'moving chore detaches relationship')
  await run(`DELETE FROM "EventPreparation" WHERE id='guard-plan'`)
  assert.equal(await value('Event','preparation_epoch','guard-event'),2)
  await addPlan()
  assert.equal(await value('Event','preparation_epoch','guard-event'),3,'plan recreated invalidates old snapshot')
  await run(`UPDATE "Event" SET family_id='schema-b' WHERE id='guard-event'`)
  assert.equal(await value('EventPreparation','id','guard-plan'),undefined,'moving event detaches plan')
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[])
  return { identity:true, sourceVersion:true, lifecycle:true, taskEpoch:true, householdMoves:true }
}
