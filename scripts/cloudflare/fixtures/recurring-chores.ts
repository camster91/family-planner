import { expandD1RecurringSeries, topUpD1HouseholdSeries } from '../../../src/lib/cloudflare/recurring-chores'
import { loadD1AssistantTodayContext } from '../../../src/lib/cloudflare/assistant-context'
import type { NativeD1 } from '../../../src/lib/cloudflare/read-client'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value:unknown,label:string):asserts value {if(!value)throw new Error(label)}
export async function testRecurringChores(db:D1Store){
  const now=new Date('2026-10-28T16:00:00Z'),day=Date.parse('2026-10-28T00:00:00Z')
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('recur-a','Fixture','recur-a','{"chores":true}'),('recur-b','Other','recur-b','{"chores":true}')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role) VALUES ('recur-parent','recur-parent@example.test','Parent','recur-a','parent'),('recur-teen','recur-teen@example.test','Teen','recur-a','teen'),('recur-other','recur-other@example.test','Other','recur-b','parent')`).run()
  const seed=async(id:string,frequency='daily',date=day,extra:Record<string,unknown>={})=>{
    await db.prepare(`INSERT INTO "Chore"(id,family_id,title,description,points,difficulty,created_by,assigned_to,due_date,frequency,recurrence_id,is_template,icon,routine,routine_order,weekly_days,rotation_member_ids)
      VALUES (?1,'recur-a','Repeated task','Instructions',5,'easy','recur-parent','recur-parent',?2,?3,?1,1,'brush-teeth','Morning',2,?4,?5)`).bind(id,date,frequency,JSON.stringify(extra.weekly_days??[]),JSON.stringify(extra.rotation??[])).run()
  }
  const dates=async(id:string)=>(await db.prepare(`SELECT due_date,assigned_to,assigned_member_id,frequency,status,is_template,routine_anchor,routine_duration_minutes FROM "Chore" WHERE recurrence_id=?1 ORDER BY due_date,id`).bind(id).all<{due_date:number;assigned_to:string|null;assigned_member_id:string|null;frequency:string;status:string;is_template:number;routine_anchor:string|null;routine_duration_minutes:number|null}>()).results
  await seed('recur-daily')
  const race=await Promise.all(Array.from({length:8},()=>expandD1RecurringSeries('recur-daily','recur-a',now,db)))
  check(race.reduce((a,b)=>a+b,0)===6&&(await dates('recur-daily')).length===7,'concurrent daily expansion fills one bounded seven-day window')
  check(await expandD1RecurringSeries('recur-daily','recur-b',now,db)===0,'foreign family cannot expand root')
  await seed('recur-weekly','weekly',day,{weekly_days:[1,3,5]})
  check(await expandD1RecurringSeries('recur-weekly','recur-a',now,db)===11,'multi-weekday schedule retains four-week occurrence budget')
  check((await dates('recur-weekly')).every(row=>[1,3,5].includes(new Date(row.due_date).getUTCDay())),'only chosen weekdays')
  await seed('recur-monthly','monthly',Date.parse('2026-01-31T00:00:00Z'))
  await expandD1RecurringSeries('recur-monthly','recur-a',new Date('2026-01-31T12:00:00Z'),db)
  check(JSON.stringify((await dates('recur-monthly')).map(row=>new Date(row.due_date).toISOString().slice(0,10)))===JSON.stringify(['2026-01-31','2026-02-28','2026-03-31']),'monthly anchor clamps and returns to original day')
  await seed('recur-old','daily',day-90*86400000)
  await expandD1RecurringSeries('recur-old','recur-a',now,db)
  const resumed=(await dates('recur-old')).slice(1)
  check(resumed.length===7&&resumed.every(row=>row.due_date>=day&&row.due_date<day+7*86400000),'missed history is not backfilled and horizon remains bounded')
  await seed('recur-rotate','daily',day,{rotation:['recur-parent','recur-teen','recur-other']})
  await db.prepare(`UPDATE "Chore" SET rotation_index=0 WHERE id='recur-rotate'`).run()
  await expandD1RecurringSeries('recur-rotate','recur-a',now,db)
  check(JSON.stringify((await dates('recur-rotate')).slice(1).map(row=>row.assigned_to))===JSON.stringify(['recur-teen','recur-parent','recur-teen','recur-parent','recur-teen','recur-parent']),'rotation advances once per slot and skips departed/foreign accounts')
  process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED='1';process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY='1';process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED='1'
  await db.prepare(`INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('recur-profile','recur-a','Young child','child',3)`).run()
  await seed('recur-profile-root')
  await db.prepare(`UPDATE "Chore" SET assigned_to=NULL,assigned_member_id='recur-profile' WHERE id='recur-profile-root'`).run()
  check(await expandD1RecurringSeries('recur-profile-root','recur-a',now,db)===6&&(await dates('recur-profile-root')).every(row=>row.assigned_to===null&&row.assigned_member_id==='recur-profile'),'email-free profile gets no invented login account')
  await db.prepare(`UPDATE "HouseholdMember" SET archived_at=?1 WHERE id='recur-profile'`).bind(Date.now()).run()
  check(await expandD1RecurringSeries('recur-profile-root','recur-a',new Date(day+20*86400000),db)===0,'archived profile cannot get new work')
  process.env.ROUTINE_SCHEDULE_ENABLED='1';process.env.ROUTINE_SCHEDULE_ROLLBACK_READY='1'
  const definition=(frequency='daily')=>({protocol:'herewoven.routine-step-series.v1',revision:1,once_pending:frequency==='once',stack_id:null,state:'active',effective_on:'2026-10-28',anchor:'After breakfast',schedule:{frequency,starts_on:'2026-10-28',weekly_days:[],monthly_day:null},content:{title:'Authored future step',description:null,subject:{kind:'account',user_id:'recur-parent',member_id:null},points:8,difficulty:'easy',icon:null,duration_minutes:10}})
  await seed('recur-authored','once',day-86400000)
  await db.prepare(`UPDATE "Chore" SET routine_series_config=?1 WHERE id='recur-authored'`).bind(JSON.stringify(definition())).run()
  check(await expandD1RecurringSeries('recur-authored','recur-a',now,db)===7,'authored future definition overrides historical once fields')
  check((await dates('recur-authored')).slice(1).every(row=>row.routine_anchor==='After breakfast'&&row.routine_duration_minutes===10),'authored cue/duration snapshot preserved')
  await seed('recur-once','once',day-86400000)
  await db.prepare(`UPDATE "Chore" SET routine_series_config=?1 WHERE id='recur-once'`).bind(JSON.stringify(definition('once'))).run()
  await topUpD1HouseholdSeries('recur-a',now,db)
  check((await dates('recur-once')).length===2&&(await db.prepare(`SELECT json_extract(routine_series_config,'$.once_pending') AS pending FROM "Chore" WHERE id='recur-once'`).first<{pending:number}>())?.pending===0,'explicit once handover settles atomically')
  check(await expandD1RecurringSeries('recur-once','recur-a',new Date(day+86400000),db)===0,'once schedule never becomes a new daily task')
  const stacked={...definition(),stack_id:'recur-stack'}
  const stack={protocol:'herewoven.routine-schedule.v1',state:stacked.state,effective_on:stacked.effective_on,anchor:stacked.anchor,schedule:stacked.schedule,steps:[{template_id:'recur-stacked'}]}
  await db.prepare(`INSERT INTO "RoutineStack"(id,family_id,label,fingerprint,schedule_config) VALUES ('recur-stack','recur-a','Household morning','fixture',?1)`).bind(JSON.stringify(stack)).run()
  await seed('recur-stacked','once',day-86400000)
  await db.prepare(`UPDATE "Chore" SET routine_series_config=?1 WHERE id='recur-stacked'`).bind(JSON.stringify(stacked)).run()
  check(await expandD1RecurringSeries('recur-stacked','recur-a',now,db)===7,'stack-linked authored schedule expands')
  check((await db.prepare(`SELECT routine,routine_order,routine_stack_id FROM "Chore" WHERE recurrence_id='recur-stacked' AND id<>'recur-stacked' LIMIT 1`).first<{routine:string;routine_order:number;routine_stack_id:string}>())?.routine==='Household morning','stack presentation comes from current definition')
  await db.prepare(`UPDATE "RoutineStack" SET schedule_config=json_set(schedule_config,'$.anchor','Changed stack cue') WHERE id='recur-stack'`).run()
  check(await expandD1RecurringSeries('recur-stacked','recur-a',new Date(day+20*86400000),db)===0,'contradictory stack definition never falls back to historical fields')
  await seed('recur-unknown')
  await db.prepare(`UPDATE "Chore" SET routine_series_config='{"protocol":"herewoven.routine-step-series.v1","future_version":2}' WHERE id='recur-unknown'`).run()
  check(await expandD1RecurringSeries('recur-unknown','recur-a',now,db)===0,'unknown future metadata holds')
  await seed('recur-rollback')
  await db.prepare(`CREATE TRIGGER fixture_recur_abort BEFORE INSERT ON "Chore" WHEN NEW.recurrence_id='recur-rollback' AND NEW.due_date=${day+2*86400000} BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
  let aborted=false
  try{await expandD1RecurringSeries('recur-rollback','recur-a',now,db)}catch{aborted=true}
  check(aborted&&(await dates('recur-rollback')).length===1,'later insertion failure rolls back every generated occurrence')
  await db.prepare('DROP TRIGGER fixture_recur_abort').run()
  function racingWrite(sql:string):D1Store{let changed=false;return{prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),async batch(statements){if(!changed){changed=true;await db.prepare(sql).run()}return session.batch(statements)}}}}}
  await seed('recur-stop-race')
  check(await expandD1RecurringSeries('recur-stop-race','recur-a',now,racingWrite(`UPDATE "Chore" SET frequency='once',is_template=0 WHERE id='recur-stop-race'`))===0&&(await dates('recur-stop-race')).length===1,'stopped series cannot commit stale copies')
  await seed('recur-edit-race')
  check(await expandD1RecurringSeries('recur-edit-race','recur-a',now,racingWrite(`UPDATE "Chore" SET title='Updated definition' WHERE id='recur-edit-race'`))===6,'changed root replans against its current content')
  check((await db.prepare(`SELECT count(*) AS n FROM "Chore" WHERE recurrence_id='recur-edit-race' AND title<>'Updated definition'`).first<{n:number}>())?.n===0,'no stale title copied')
  await db.prepare(`INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('recur-profile-once','recur-a','Another child','child',4)`).run()
  await seed('recur-profile-archive-race')
  await db.prepare(`UPDATE "Chore" SET assigned_to=NULL,assigned_member_id='recur-profile-once' WHERE id='recur-profile-archive-race'`).run()
  check(await expandD1RecurringSeries('recur-profile-archive-race','recur-a',now,racingWrite(`UPDATE "HouseholdMember" SET archived_at=${Date.now()} WHERE id='recur-profile-once'`))===0,'profile archived during expansion gets no copies')
  await seed('recur-race')
  let changed=false
  const racing:D1Store={prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),async batch(statements){if(!changed){changed=true;await db.prepare(`UPDATE "Family" SET features='{"chores":false}' WHERE id='recur-a'`).run()}return session.batch(statements)}}}}
  check(await expandD1RecurringSeries('recur-race','recur-a',now,racing)===0&&(await dates('recur-race')).length===1,'feature-off before batch creates no stale work')
  await db.prepare(`UPDATE "Family" SET features='{"chores":true}' WHERE id='recur-a'`).run()
  await db.prepare(`INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('recur-once-profile','recur-a','One-time helper','child',3)`).run()
  await seed('recur-once-profile-root','once',day-86400000)
  const profileOnce={...definition('once'),content:{...definition('once').content,subject:{kind:'profile',member_id:'recur-once-profile'}}}
  await db.prepare(`UPDATE "Chore" SET assigned_to=NULL,assigned_member_id='recur-once-profile',routine_series_config=?1 WHERE id='recur-once-profile-root'`).bind(JSON.stringify(profileOnce)).run()
  process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED='0'
  await topUpD1HouseholdSeries('recur-a',now,db)
  check((await dates('recur-once-profile-root')).length===2,'explicit once profile work does not require enabling recurring profile work')
  process.env.HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED='1'
  const context=await loadD1AssistantTodayContext({userId:'recur-parent',familyId:'recur-a',role:'parent',surface:'person',serverNow:now,viewerTimeZone:'UTC'},db as unknown as NativeD1)
  check(context!==null&&context.today.chores.length>0,'normal Today context uses native foreground top-up')
  process.env.FAIR_CHORE_TOP_UP_ENABLED='1';process.env.FAIR_CHORE_TOP_UP_ROLLBACK_READY='1'
  let tick=0
  await topUpD1HouseholdSeries('recur-a',now,db,()=>tick++)
  check((await db.prepare(`SELECT after_id FROM "ChoreTopUpCursor" WHERE family_id='recur-a'`).first<{after_id:string}>())?.after_id,'fair traversal records an attempted root')
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<105)
    INSERT INTO "Chore"(id,family_id,title,created_by,assigned_to,due_date,frequency,recurrence_id,is_template)
    SELECT 'zz-recur-'||printf('%03d',x),'recur-a','Fair traversal fixture','recur-parent','recur-parent',?1,'daily','zz-recur-'||printf('%03d',x),1 FROM n`).bind(day).run()
  for(let visit=0;visit<2;visit++){let clockTick=0;await topUpD1HouseholdSeries('recur-a',now,db,()=>clockTick++)}
  check((await db.prepare(`SELECT count(DISTINCT recurrence_id) AS n FROM "Chore" WHERE family_id='recur-a' AND recurrence_id LIKE 'zz-recur-%' AND is_template=0`).first<{n:number}>())?.n===105,'fair cursor reaches every series beyond the first hundred across visits')
  return {dailyRace:8,weeklyDays:true,monthlyAnchor:true,boundedResume:true,rotationEligibility:true,emailFreeProfiles:true,archivedRefusal:true,authoredFutureDefinitions:true,cueAndDuration:true,onceHandover:true,stackDefinitions:true,unknownMetadataHold:true,atomicInsertRollback:true,stoppedAndEditedRootRaces:true,profileArchiveRace:true,atomicFeatureRace:true,normalTodayContext:true,fairTraversal:true,fairOver100:true,onceProfileWithoutRecurrenceGate:true}
}
