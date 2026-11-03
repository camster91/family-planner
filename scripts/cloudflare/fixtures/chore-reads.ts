import { readD1PreparationPicker } from "../../../src/lib/cloudflare/preparation-picker"
import { reviewD1PreparationRequest } from "../../../src/lib/cloudflare/preparation-recovery"
import { hashIdempotentRequest } from "../../../src/lib/idempotency-hash"
import { PREPARATION_ACTION } from "../../../src/lib/event-preparation/http"
import { writeD1EventPreparation } from "../../../src/lib/cloudflare/preparation-write"
import { EVENT_PREPARATION_PROTOCOL } from "../../../src/lib/event-preparation/contract"
import { readD1PreparationSource } from "../../../src/lib/cloudflare/preparation-source"
import { readD1ParentPreparationContext } from '../../../src/lib/cloudflare/preparation-context'
import { d1EventPreparationStorageAvailable } from '../../../src/lib/cloudflare/chore-read-policy'
import { preparationCopyFactId } from '../../../src/lib/event-preparation/origin'
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
  await db.prepare(`INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position) VALUES ('chore-read-plan-step','chore-read-a','chore-read-plan','chore-read-visible-teen',1)`).run()
  const cues=await readD1OwnPreparationContext({userId:'chore-read-teen',familyId:'chore-read-a',role:'teen',choreIds:['chore-read-visible-teen','chore-read-visible-parent','chore-read-foreign']},db)
  check(Object.keys(cues).length===1&&cues['chore-read-visible-teen']?.eventTitle==='School concert','kid preparation cue is limited to their actual assigned canonical work')
  stage='parent preparation context'
  check(await d1EventPreparationStorageAvailable(db),'complete native preparation storage is ready')
  const guard=await db.prepare(`SELECT sql FROM sqlite_master WHERE name='EventPreparationStep_bounds_update'`).first<{sql:string}>()
  check(guard?.sql,'bounds trigger exists')
  await db.prepare(`DROP TRIGGER "EventPreparationStep_bounds_update"`).run()
  check(!await d1EventPreparationStorageAvailable(db),'partial native preparation storage is refused')
  await db.prepare(guard.sql).run()
  const preparationActor={userId:'chore-read-parent',familyId:'chore-read-a',role:'parent',tokenVersion:0,choreIds:['chore-read-visible-teen','chore-read-foreign']}
  const linked=await readD1ParentPreparationContext(preparationActor,db)
  check(Object.keys(linked.backlinks).length===1&&linked.backlinks['chore-read-visible-teen']==='chore-read-event','parent sees only household event backlinks')
  for(const override of [{userId:'chore-read-teen'},{familyId:'chore-read-b'},{tokenVersion:1},{role:'child'}]) {
    const denied=await readD1ParentPreparationContext({...preparationActor,...override},db)
    check(!Object.keys(denied.backlinks).length&&!Object.keys(denied.origins).length,'role, household and stale-generation parent reads withheld')
  }
  await db.prepare(`INSERT INTO "RoutineStack"(id,family_id,label,fingerprint) VALUES ('chore-read-stack','chore-read-a','School morning',?1)`).bind('a'.repeat(64)).run()
  await db.prepare(`UPDATE "Chore" SET routine_stack_id='chore-read-stack' WHERE id='chore-read-visible-parent'`).run()
  const factId=preparationCopyFactId('chore-read-a','chore-read-visible-teen')
  const fact={timeline:1,actorKind:'person',target:{kind:'chore',id:'chore-read-visible-teen'},routineCopy:{stackId:'chore-read-stack',sourceChoreId:'chore-read-visible-parent',occurrenceDay:'2026-10-28'}}
  await db.prepare(`INSERT INTO "Activity"(id,family_id,user_id,type,title,metadata,created_at) VALUES (?1,'chore-read-a','chore-read-parent','preparation_routine_copied','Fixture copy',?2,?3)`).bind(factId,JSON.stringify(fact),day).run()
  const copied=await readD1ParentPreparationContext(preparationActor,db)
  check(copied.origins['chore-read-visible-teen']?.state==='available','valid routine source is discoverable')
  await db.prepare(`UPDATE "Chore" SET routine_stack_id=NULL WHERE id='chore-read-visible-parent'`).run()
  const removed=await readD1ParentPreparationContext(preparationActor,db)
  check(removed.origins['chore-read-visible-teen']?.state==='unavailable'&&!JSON.stringify(removed.origins).includes('School morning'),'removed routine source keeps copy fact without disclosing stale label')
  await db.prepare(`UPDATE "Activity" SET metadata='invalid json' WHERE id=?1`).bind(factId).run()
  check(!Object.keys((await readD1ParentPreparationContext(preparationActor,db)).origins).length,'corrupt provenance never becomes a link')
  stage='native preparation source'
  const sourceActor={userId:'chore-read-parent',familyId:'chore-read-a',tokenVersion:0}
  const sourceScope={eventId:'chore-read-event',timeZone:'America/Toronto',memberProtocol:2 as const,choreIds:['chore-read-visible-parent'],subjects:[],routine:null}
  const source=await readD1PreparationSource(sourceActor,sourceScope,db)
  check(source.state?.links.length===1&&source.context.complete&&source.context.tasks.length===2,'source includes selected and already-linked canonical chores')
  check(source.tasks.every(row=>row.task.linkable)&&source.context.tasks.find(row=>row.id==='chore-read-visible-parent')?.dateEditable,'source preserves eligibility and once-only retiming')
  const stable=await readD1PreparationSource(sourceActor,sourceScope,db)
  check(stable.context.viewToken===source.context.viewToken,'unchanged native source has a stable review token')
  await db.prepare(`UPDATE "Chore" SET title='Changed after review' WHERE id='chore-read-visible-parent'`).run()
  const updated=await readD1PreparationSource(sourceActor,sourceScope,db)
  check(updated.context.viewToken!==source.context.viewToken,'canonical content change invalidates the reviewed source')
  const foreign=await readD1PreparationSource(sourceActor,{...sourceScope,choreIds:['chore-read-foreign']},db)
  check(!foreign.context.complete&&!JSON.stringify(foreign).includes('PRIVATE FOREIGN'),'foreign selected work is incomplete and never disclosed')
  for(const override of [{userId:'chore-read-teen'},{familyId:'chore-read-b'},{tokenVersion:1}]){
    let denied=false
    try{await readD1PreparationSource({...sourceActor,...override},sourceScope,db)}catch{denied=true}
    check(denied,'source refuses teen, foreign household and revoked session')
  }
  stage='native preparation write'
  process.env.FAMILY_EVENT_PREPARATION_READY='1'
  process.env.QUEUE_OWNER_RECOVERY_ENABLED='1'
  process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY='1'
  const writeScope={...sourceScope,choreIds:['chore-read-visible-parent','chore-read-visible-teen']}
  const writeSource=await readD1PreparationSource(sourceActor,writeScope,db)
  const command={protocol:EVENT_PREPARATION_PROTOCOL,owner:{userId:sourceActor.userId,familyId:sourceActor.familyId},memberProtocol:2,action:'set-plan',eventId:writeScope.eventId,timeZone:writeScope.timeZone,issuedAt:now.toISOString(),eventSourceToken:writeSource.context.event.sourceToken,expectedToken:writeSource.context.viewToken,eventChangeDecision:'keep-dates',steps:['chore-read-visible-parent','chore-read-visible-teen'].map(choreId=>({kind:'existing',choreId,sourceToken:writeSource.context.tasks.find(task=>task.id===choreId)!.sourceToken,cue:null,retimeTo:null}))}
  const picker=await readD1PreparationPicker(sourceActor,{kind:'tasks',eventId:sourceScope.eventId,timeZone:sourceScope.timeZone,memberProtocol:'2',search:'Changed after review'},db)
  check(picker.items.length===1&&picker.items[0].id==='chore-read-visible-parent','native task picker finds current household work')
  const literal=await readD1PreparationPicker(sourceActor,{kind:'accounts',eventId:sourceScope.eventId,timeZone:sourceScope.timeZone,memberProtocol:'2',search:'%'},db)
  check(literal.items.length===0,'picker treats percent as literal text rather than a wildcard')
  const people=await readD1PreparationPicker(sourceActor,{kind:'accounts',eventId:sourceScope.eventId,timeZone:sourceScope.timeZone,memberProtocol:'2',search:''},db)
  check(people.items.length===2&&!JSON.stringify(people).includes('PRIVATE FOREIGN'),'account picker stays within the household')
  const entry={kind:'event-preparation' as const,key:'preparation-write-fixture-1',body:JSON.stringify(command),requestHash:hashIdempotentRequest(PREPARATION_ACTION,command)}
  const review=await reviewD1PreparationRequest(sourceActor,entry,'a'.repeat(64),db,now)
  check(review.state==='ready'&&review.canRetry,'unsent exact current request is recoverable')
  const written=await writeD1EventPreparation(sourceActor,command,'preparation-write-fixture-1',db,now)
  check(written.status===200&&!written.replayed&&written.body.receipt.planId==='chore-read-plan','native preparation write committed')
  const steps=await db.prepare(`SELECT id,chore_id,position FROM EventPreparationStep WHERE preparation_id='chore-read-plan' ORDER BY position`).all<{id:string,chore_id:string,position:number}>()
  check(steps.results?.length===2&&steps.results[1].id==='chore-read-plan-step'&&steps.results[0].position===1&&steps.results[1].position===2,'reorder retains link identity and valid positions')
  const replay=await writeD1EventPreparation(sourceActor,command,'preparation-write-fixture-1',db,now)
  check(replay.replayed&&JSON.stringify(replay.body)===JSON.stringify(written.body),'same request replays receipt without duplicate changes')
  check((await reviewD1PreparationRequest(sourceActor,entry,'a'.repeat(64),db,now)).state==='committed','lost-response inspection identifies an already committed save')
  let staleDenied=false
  try{await writeD1EventPreparation(sourceActor,command,'preparation-write-fixture-stale',db,now)}catch{staleDenied=true}
  check(staleDenied,'old review cannot write again under a new request key')
  const detachSource=await readD1PreparationSource(sourceActor,{...sourceScope,choreIds:[]},db)
  const detach={...command,expectedToken:detachSource.context.viewToken,eventSourceToken:detachSource.context.event.sourceToken,eventChangeDecision:null,steps:[]}
  await writeD1EventPreparation(sourceActor,detach,'preparation-write-fixture-detach',db,now)
  check(!await db.prepare(`SELECT id FROM EventPreparation WHERE id='chore-read-plan'`).first()&&!!await db.prepare(`SELECT id FROM Chore WHERE id='chore-read-visible-teen'`).first(),'detach deletes only the preparation plan and retains canonical work')
  const newSubject={kind:'account' as const,accountId:sourceActor.userId}
  const createScope={...sourceScope,choreIds:[],subjects:[newSubject]}
  const createSource=await readD1PreparationSource(sourceActor,createScope,db)
  const createCommand={...command,eventChangeDecision:null,expectedToken:createSource.context.viewToken,eventSourceToken:createSource.context.event.sourceToken,steps:[{kind:'new',clientId:'new-native-step',title:'Pack concert bag',description:null,subject:newSubject,points:null,difficulty:'easy',icon:null,durationMinutes:5,dueDay:'2026-10-28',cue:null}]}
  const failBatch:D1Store={prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),batch(statements){return session.batch([...statements,session.prepare(`INSERT INTO Family(id,name,invite_code) VALUES ('chore-read-a','duplicate','duplicate')`)])}}}}
  let rolledBack=false
  try{await writeD1EventPreparation(sourceActor,createCommand,'preparation-write-fixture-create',failBatch,now)}catch{rolledBack=true}
  check(rolledBack&&!await db.prepare(`SELECT id FROM Chore WHERE title='Pack concert bag'`).first()&&!await db.prepare(`SELECT id FROM IdempotencyRecord WHERE key='preparation-write-fixture-create'`).first(),'failed atomic batch retains neither partial chore nor receipt')
  const creation=await writeD1EventPreparation(sourceActor,createCommand,'preparation-write-fixture-create',db,now)
  const createdTask=await db.prepare(`SELECT c.status,c.frequency,c.assigned_to FROM Chore c JOIN EventPreparationStep s ON s.chore_id=c.id WHERE c.title='Pack concert bag'`).first<{status:string,frequency:string,assigned_to:string}>()
  check(creation.body.receipt.createdCount===1&&createdTask?.status==='pending'&&createdTask.frequency==='once'&&createdTask.assigned_to===sourceActor.userId,'creation persists a real canonical once-only task linked to the event')
  stage='native routine copy to email-free profile'
  process.env.HOUSEHOLD_PROFILE_CHORE_ENABLED='1'
  process.env.HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY='1'
  await db.prepare(`UPDATE Chore SET routine_stack_id='chore-read-stack',routine_order=1 WHERE id='chore-read-visible-parent'`).run()
  const profileSubject={kind:'profile' as const,memberId:'chore-read-profile-1'}
  const reuseScope={...sourceScope,choreIds:[],subjects:[profileSubject],routine:{stackId:'chore-read-stack',occurrenceDay:'2026-10-28'}}
  const reuseSource=await readD1PreparationSource(sourceActor,reuseScope,db)
  check(reuseSource.context.routine?.steps.length===1&&reuseSource.context.routine.steps[0].copyable,'native routine source retains exact eligible occurrence')
  const reuseCommand={...command,action:'reuse-routine',eventChangeDecision:null,expectedToken:reuseSource.context.viewToken,eventSourceToken:reuseSource.context.event.sourceToken,stackId:reuseScope.routine.stackId,sourceToken:reuseSource.context.routine!.sourceToken,occurrenceDay:reuseScope.routine.occurrenceDay,steps:[{sourceId:'chore-read-visible-parent',sourceToken:reuseSource.context.routine!.steps[0].sourceToken,clientId:'profile-copy',subject:profileSubject,points:null,dueDay:'2026-10-28',cue:null}]}
  const reused=await writeD1EventPreparation(sourceActor,reuseCommand,'preparation-write-fixture-profile',db,now)
  const profileCopy=await db.prepare(`SELECT c.id,c.assigned_to,c.routine_stack_id,c.frequency,c.status FROM Chore c JOIN EventPreparationStep s ON s.chore_id=c.id WHERE c.assigned_member_id='chore-read-profile-1' AND s.preparation_id=?`).bind(reused.body.receipt.planId).first<{id:string,assigned_to:null,routine_stack_id:null,frequency:string,status:string}>()
  check(profileCopy&&profileCopy.assigned_to===null&&profileCopy.routine_stack_id===null&&profileCopy.frequency==='once'&&profileCopy.status==='pending','routine copy creates independent pending work for an email-free profile')
  check(!!await db.prepare(`SELECT id FROM Activity WHERE id=? AND type='preparation_routine_copied'`).bind(preparationCopyFactId(sourceActor.familyId,profileCopy.id)).first(),'routine copy provenance commits with the canonical task')
  const profilePage=await readD1PreparationPicker(sourceActor,{kind:'profiles',eventId:sourceScope.eventId,timeZone:sourceScope.timeZone,memberProtocol:'2',search:'Profile'},db)
  check(profilePage.items.length===20&&!!profilePage.next,'profile picker preserves bounded pagination')
  process.env.FAMILY_EVENT_PREPARATION_READY='0'
  check((await writeD1EventPreparation(sourceActor,command,'preparation-write-fixture-1',db,now)).replayed,'receipt survives source removal and feature pause')
  check((await reviewD1PreparationRequest(sourceActor,entry,'a'.repeat(64),db,new Date(+now+86400000))).state==='committed','historical success is inspected before command age, target and readiness checks')
  let changed=false
  const racing:D1Store={prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),async batch(statements){if(!changed){changed=true;await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='chore-read-parent'`).run()}return session.batch(statements)}}}}
  let sourceRaceDenied=false
  try{await readD1PreparationSource(sourceActor,sourceScope,racing)}catch{sourceRaceDenied=true}
  check(sourceRaceDenied,'source witness refuses a session revoked between source read and return')
  check(await readD1ChoreNotificationFocus(parent,'chore-read-visible-parent',racing)===null&&!await renewD1ChoreReadOwner(parent,db),'authority changed during private focus invalidates the captured read')
  return{visibleCapAfter240Hidden:true,evidenceRetained:true,scopedDatePolicy:true,profileBatch61:true,compositeRelationBatch61:true,foreignProfileRefusal:true,scheduledOncePolicy:true,streakMarkers:true,parentAndTeenFocus:true,hiddenAndForeignFocusRefusal:true,privateMetadataStrip:true,atomicOwnerRace:true,kidHomeReads:true,ownedPreparationCue:true,parentPreparationContext:true,nativePreparationSource:true,nativePreparationWrites:true,preparationPickers:true,preparationRecovery:true,profileRoutineCopy:true,preparationSourceRace:true,preparationStorageGuard:true,routineProvenance:true}
 }catch(cause){throw new Error(`${stage}: ${cause instanceof Error?cause.stack:"unknown fixture failure"}`)}
}
