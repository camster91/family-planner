import { readD1KidDashboardData } from '../../../src/lib/cloudflare/kid-dashboard'
import { hiddenD1RoutineOccurrenceIds,scheduledOnceD1RoutineOccurrenceIds,hydrateD1ChoreProfileMembers,readD1ChoreStreaks,readD1OwnPreparationContext } from '../../../src/lib/cloudflare/chore-read-policy'
import { readD1ChoreNotificationFocus,renewD1ChoreReadOwner } from '../../../src/lib/cloudflare/chore-read-owner'
import { withChoreReads } from '../../../src/lib/chore-read-scope'
import { readVisibleChoreRows } from '../../../src/lib/chore-visible-read'
import { afterChoreCursor,choreOrderBy } from '../../../src/lib/chore-paging'
import { publicChoreData } from '../../../src/lib/chore-public-data'
import type { NativeD1 } from '../../../src/lib/cloudflare/read-client'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value:unknown,label:string):asserts value{if(!value)throw new Error(label)}
export async function testChoreReads(db:D1Store){
 let stage="seed"
 try{
  process.env.HEREWOVEN_STORAGE='d1'
  const day=Date.parse('2026-10-28T00:00:00Z'),now=new Date(day+16*3600000),native=db as unknown as NativeD1
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('chore-read-a','Fixture','chore-read-a','{"chores":true}'),('chore-read-b','Other','chore-read-b','{"chores":true}')`).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role) VALUES ('chore-read-parent','chore-read-parent@example.test','Parent','chore-read-a','parent'),('chore-read-teen','chore-read-teen@example.test','Teen','chore-read-a','teen'),('chore-read-other','chore-read-other@example.test','PRIVATE FOREIGN','chore-read-b','parent')`).run()
  const definition={protocol:'herewoven.routine-step-series.v1',revision:1,stack_id:null,state:'paused',effective_on:'2026-10-28',anchor:'Private future cue',schedule:{frequency:'daily',starts_on:'2026-10-28',weekly_days:[],monthly_day:null},content:{title:'Private future title',description:null,subject:{kind:'account',user_id:'chore-read-parent',member_id:null},points:8,difficulty:'easy',icon:null,duration_minutes:10}}
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date,frequency,recurrence_id,is_template,routine_series_config) VALUES ('chore-read-paused','chore-read-a','Paused root','chore-read-parent','chore-read-parent',?1,'daily','chore-read-paused',1,?2)`).bind(day-86400000,JSON.stringify(definition)).run()
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<240)
    INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date,frequency,recurrence_id,is_template,routine_series_config)
    SELECT 'chore-read-root-'||printf('%03d',x),'chore-read-a','Paused root','chore-read-parent','chore-read-parent',?1,'daily','chore-read-root-'||printf('%03d',x),1,?2 FROM n`).bind(day-86400000,JSON.stringify(definition)).run()
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<240) INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date,recurrence_id)
    SELECT 'chore-read-hidden-'||printf('%03d',x),'chore-read-a','Hidden pristine occurrence','chore-read-parent','chore-read-parent',?1,'chore-read-root-'||printf('%03d',x) FROM n`).bind(day).run()
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date) VALUES ('chore-read-visible-parent','chore-read-a','Parent visible','chore-read-parent','chore-read-parent',?1),('chore-read-visible-teen','chore-read-a','Teen visible','chore-read-teen','chore-read-parent',?1),('chore-read-foreign','chore-read-b','PRIVATE FOREIGN','chore-read-other','chore-read-other',?1)`).bind(day).run()
  stage="visible paging"
  let readCount=0
  const visible=await withChoreReads(client=>readVisibleChoreRows({take:2,order:'asc',read:(after,take)=>{readCount++;return client.chore.findMany({where:{family_id:'chore-read-a',due_date:new Date(day),...(after?afterChoreCursor(after,'asc'):{})},orderBy:choreOrderBy('asc'),take})},hidden:ids=>hiddenD1RoutineOccurrenceIds('chore-read-a',{ids},db)}),native)
  check(visible.length===2&&visible.every(row=>row.id.includes('visible'))&&readCount>1,'hidden rows cannot consume the visible page cap')
  await db.prepare(`UPDATE "Chore" SET verified_notes='Retained evidence' WHERE id='chore-read-hidden-001'`).run()
  check(!(await hiddenD1RoutineOccurrenceIds('chore-read-a',{ids:['chore-read-hidden-001']},db)).length,'paused routine preserves evidence-bearing work')
  check((await hiddenD1RoutineOccurrenceIds('chore-read-a',{from:new Date(day),through:new Date(day)},db)).length===239,'date-filtered policy keeps complete candidate scope')
  check(!(await hiddenD1RoutineOccurrenceIds('chore-read-b',{ids:['chore-read-hidden-002']},db)).length,'metadata cannot cross households')
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<61) INSERT INTO "HouseholdMember"(id,family_id,name,role,age) SELECT 'chore-read-profile-'||x,'chore-read-a','Profile '||x,'child',3 FROM n`).run()
  stage="profile hydration"
  const profiles=await hydrateD1ChoreProfileMembers('chore-read-a',Array.from({length:61},(_,index)=>({id:String(index),assigned_member_id:'chore-read-profile-'+(index+1)})),db)
  check(profiles.length===61&&profiles.every(row=>row.assigneeMember?.family_id==='chore-read-a'),'profile hydration spans safe SQLite parameter batches')
  check((await hydrateD1ChoreProfileMembers('chore-read-b',[{assigned_member_id:'chore-read-profile-1'}],db))[0].assigneeMember===null,'foreign profiles unavailable')
  stage="once policy"
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<61)
    INSERT INTO "Chore"(id,family_id,title,assigned_to,assigned_member_id,created_by,due_date)
    SELECT 'chore-read-profile-task-'||x,'chore-read-a','Profile task',NULL,'chore-read-profile-'||x,'chore-read-parent',?1 FROM n`).bind(day).run()
  const related=await withChoreReads(client=>client.chore.findMany({where:{family_id:'chore-read-a',assigned_to:null},include:{assignee:{select:{id:true,name:true,family_id:true}},assigneeMember:{select:{id:true,family_id:true,name:true,role:true,age:true,archived_at:true,erasure_user_id:true,legacy_mapping:{select:{user_id:true}},account_link:{select:{user_id:true}}}},creator:{select:{id:true,name:true,family_id:true}}},take:200}),native)
  check(related.length===61&&related.every(row=>row.assigneeMember?.family_id==='chore-read-a'&&row.creator?.name==='Parent'),'large composite profile relation reads use explicit hydration without implicit transactions')
  const once={...definition,state:'active',schedule:{...definition.schedule,frequency:'once'},content:{...definition.content,subject:{kind:'profile',member_id:'chore-read-profile-1'}}}
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,assigned_to,assigned_member_id,created_by,due_date,recurrence_id,routine_series_config) VALUES ('chore-read-once-root','chore-read-a','Once profile',NULL,'chore-read-profile-1','chore-read-parent',?1,'chore-read-once-root',?2),('chore-read-once-copy','chore-read-a','Once profile',NULL,'chore-read-profile-1','chore-read-parent',?3,'chore-read-once-root',NULL)`).bind(day-86400000,JSON.stringify(once),day).run()
  check((await scheduledOnceD1RoutineOccurrenceIds('chore-read-a',['chore-read-once-copy'],db)).has('chore-read-once-copy'),'profile once action policy joins the independent root')
  for(let i=0;i<3;i++)await db.prepare(`INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date,status,completed_at) VALUES (?1,'chore-read-a','Streak marker','chore-read-parent','chore-read-parent',?2,'verified',?3)`).bind('chore-read-streak-'+i,day-i*86400000,day-i*86400000+3600000).run()
  stage="streaks"
  const streaks=await readD1ChoreStreaks('chore-read-a',['chore-read-parent','chore-read-other',null],now,db)
  check(streaks['chore-read-parent']===3&&streaks['chore-read-other']===0,'streaks expose bounded day markers only within the household')
  stage="focus"
  const parent={userId:'chore-read-parent',familyId:'chore-read-a',role:'parent',generation:0},teen={...parent,userId:'chore-read-teen',role:'teen'}
  check((await readD1ChoreNotificationFocus(parent,'chore-read-visible-parent',db))?.canComplete===true,'parent exact focus')
  check(await readD1ChoreNotificationFocus(teen,'chore-read-visible-parent',db)===null&&(await readD1ChoreNotificationFocus(teen,'chore-read-visible-teen',db))?.canComplete===true,'teen focus restricted to own account subject')
  check(await readD1ChoreNotificationFocus(parent,'chore-read-hidden-002',db)===null&&await readD1ChoreNotificationFocus(parent,'chore-read-foreign',db)===null,'hidden/foreign focus unavailable')
  check(!JSON.stringify(publicChoreData({chore:visible[0],template:{routine_series_config:definition}})).includes('routine_series_config'),'private future metadata never belongs in public snapshots')
  stage='kid home'
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date,recurrence_id) VALUES ('chore-read-own-paused','chore-read-a','Hidden own paused step','chore-read-teen','chore-read-parent',?1,'chore-read-paused')`).bind(day).run()
  await db.prepare(`INSERT INTO "Chore"(id,family_id,title,assigned_to,created_by,due_date) VALUES ('chore-read-own-catch-up','chore-read-a','Own older work','chore-read-teen','chore-read-parent',?1)`).bind(day-3*86400000).run()
  await db.prepare(`INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES ('chore-read-event','chore-read-a','School concert',?1,?2,'chore-read-parent')`).bind(now.getTime()+3600000,now.getTime()+7200000).run()
  const kid=await readD1KidDashboardData('chore-read-a','chore-read-teen',now,false,db)
  check(kid[0].length===1&&kid[0][0].id==='chore-read-visible-teen'&&kid[1].length===1&&kid[1][0].id==='chore-read-own-catch-up'&&kid[2][0]?.title==='School concert'&&kid[3].length===0,'kid home preserves own bounded work, hidden routine policy, shared event summaries and rewards gating')
  await db.prepare(`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES ('chore-read-plan','chore-read-a','chore-read-event',?1)`).bind('a'.repeat(64)).run()
  await db.prepare(`INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position) VALUES ('chore-read-plan-step','chore-read-a','chore-read-plan','chore-read-visible-teen',0)`).run()
  const cues=await readD1OwnPreparationContext({userId:'chore-read-teen',familyId:'chore-read-a',role:'teen',choreIds:['chore-read-visible-teen','chore-read-visible-parent','chore-read-foreign']},db)
  check(Object.keys(cues).length===1&&cues['chore-read-visible-teen']?.eventTitle==='School concert','kid preparation cue is limited to their actual assigned canonical work')
  let changed=false
  const racing:D1Store={prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),async batch(statements){if(!changed){changed=true;await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='chore-read-parent'`).run()}return session.batch(statements)}}}}
  check(await readD1ChoreNotificationFocus(parent,'chore-read-visible-parent',racing)===null&&!await renewD1ChoreReadOwner(parent,db),'authority changed during private focus invalidates the captured read')
  return{visibleCapAfter240Hidden:true,evidenceRetained:true,scopedDatePolicy:true,profileBatch61:true,compositeRelationBatch61:true,foreignProfileRefusal:true,scheduledOncePolicy:true,streakMarkers:true,parentAndTeenFocus:true,hiddenAndForeignFocusRefusal:true,privateMetadataStrip:true,atomicOwnerRace:true,kidHomeReads:true,ownedPreparationCue:true}
 }catch(cause){throw new Error(`${stage}: ${cause instanceof Error?cause.stack:"unknown fixture failure"}`)}
}
