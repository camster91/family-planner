import { transitionD1AccountChore,type D1ChoreStateActor } from '../../../src/lib/cloudflare/chore-state'
import { RoutineOccurrenceUnavailableError } from '../../../src/lib/routine-occurrence-policy'
import { HouseholdMemberIdentityConflict } from '../../../src/lib/household-member-lifecycle'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value:unknown,label:string):asserts value{if(!value)throw new Error(label)}
export async function testChoreState(db:D1Store){
 const now=new Date('2026-10-28T16:00:00Z'),day=Date.parse('2026-10-28T00:00:00Z')
 await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('state-a','Fixture','state-a','{"chores":true}'),('state-b','Other','state-b','{"chores":true}')`).run()
 await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role) VALUES ('state-parent','state-parent@example.test','Parent','state-a','parent'),('state-teen','state-teen@example.test','Teen','state-a','teen'),('state-sibling','state-sibling@example.test','Sibling','state-a','child'),('state-other','state-other@example.test','Other','state-b','parent')`).run()
 const parent:D1ChoreStateActor={userId:'state-parent',familyId:'state-a',role:'parent',generation:0},teen={...parent,userId:'state-teen',role:'teen'},sibling={...parent,userId:'state-sibling',role:'child'}
 const options={database:db,now}
 const seed=async(id:string,frequency='once',series=false,date=day)=>db.prepare(`INSERT INTO "Chore"(id,family_id,title,description,points,assigned_to,created_by,due_date,frequency,recurrence_id,is_template,weekly_days)
  VALUES (?1,'state-a',?1,'Instructions',15,'state-teen','state-parent',?2,?3,?4,?5,?6)`).bind(id,date,frequency,series?id:null,series?1:0,frequency==='weekly'?'[1,4]':'[]').run()
 const row=async(id:string)=>db.prepare('SELECT status,completed_at,successor_id,photo_url,photo_verified,preparation_epoch FROM "Chore" WHERE id=?1').bind(id).first<{status:string;completed_at:number|null;successor_id:string|null;photo_url:string|null;photo_verified:number;preparation_epoch:number}>()
 const activity=async(id:string)=>(await db.prepare(`SELECT count(*) AS n FROM "Activity" WHERE family_id='state-a' AND json_extract(metadata,'$.target.id')=?1`).bind(id).first<{n:number}>())!.n
 await seed('state-once')
 const completes=await Promise.all(Array.from({length:8},()=>transitionD1AccountChore(teen,{kind:'complete',choreId:'state-once'},options)))
 check(completes.every(r=>r.status===200)&&completes.filter(r=>r.completed).length===1&&await activity('state-once')===1,'eight ticks yield one status effect and one activity')
 check((await row('state-once'))?.completed_at===now.getTime()&&(await row('state-once'))?.preparation_epoch===1,'stored completion instant and independent epoch')
 check((await transitionD1AccountChore(sibling,{kind:'undo',choreId:'state-once'},options)).status===403,'sibling cannot undo someone else')
 const undos=await Promise.all(Array.from({length:8},()=>transitionD1AccountChore(teen,{kind:'undo',choreId:'state-once'},options)))
 check(undos.every(r=>r.status===200)&&undos.filter(r=>(r.body as {alreadyOpen?:boolean}).alreadyOpen).length===7&&(await row('state-once'))?.status==='pending','Undo converges and clears completion')
 check((await row('state-once'))?.preparation_epoch===2,'undo advances state epoch rather than restoring an old version')
 await seed('state-any-member')
 check((await transitionD1AccountChore(sibling,{kind:'complete',choreId:'state-any-member'},options)).completed,'D3 intentionally permits any household member to tick an account chore')
 await seed('state-legacy','weekly')
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-legacy'},options)).completed,'legacy repeating completion')
 const successor=(await row('state-legacy'))!.successor_id!
 const next=await db.prepare('SELECT due_date,frequency,recurrence_id FROM "Chore" WHERE id=?1').bind(successor).first<{due_date:number;frequency:string;recurrence_id:string|null}>()
 check(next?.due_date===day+86400000&&next.frequency==='once'&&next.recurrence_id===null,'exact legacy selected-weekday successor')
 await transitionD1AccountChore(teen,{kind:'undo',choreId:'state-legacy'},options)
 check(!await row(successor),'Undo deletes only its recorded pending successor')
 await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-legacy'},options)
 check((await row('state-legacy'))?.successor_id!==successor&&await activity('state-legacy')===2,'retick makes one new successor and counts one new completion')
 await seed('state-series','daily',true,day-20*86400000)
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-series'},options)).completed,'series completion')
 check((await db.prepare(`SELECT count(*) AS n FROM "Chore" WHERE recurrence_id='state-series'`).first<{n:number}>())?.n===8,'status/activity and bounded native series top-up commit together')
 await seed('state-paused','daily',true)
 const paused={protocol:'herewoven.routine-step-series.v1',revision:1,stack_id:null,state:'paused',effective_on:'2026-10-28',anchor:null,schedule:{frequency:'daily',starts_on:'2026-10-28',weekly_days:[],monthly_day:null},content:{title:'Paused',description:null,subject:{kind:'account',user_id:'state-teen',member_id:null},points:15,difficulty:'medium',icon:null,duration_minutes:null}}
 await db.prepare(`UPDATE "Chore" SET routine_series_config=?1 WHERE id='state-paused'`).bind(JSON.stringify(paused)).run()
 let pausedRefused=false;try{await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-paused'},options)}catch(cause){pausedRefused=cause instanceof RoutineOccurrenceUnavailableError}check(pausedRefused&&(await row('state-paused'))?.status==='pending','paused routine cannot be completed through a legacy account endpoint')
 await seed('state-rollback','daily',true,day-20*86400000)
 await db.prepare(`CREATE TRIGGER fixture_state_activity_abort BEFORE INSERT ON "Activity" WHEN json_extract(NEW.metadata,'$.target.id')='state-rollback' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
 let aborted=false;try{await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-rollback'},options)}catch{aborted=true}
 check(aborted&&(await row('state-rollback'))?.status==='pending'&&(await row('state-rollback'))?.preparation_epoch===0&&(await db.prepare(`SELECT count(*) AS n FROM "Chore" WHERE recurrence_id='state-rollback'`).first<{n:number}>())?.n===1,'activity failure rolls back status, epoch and all series copies')
 await db.prepare('DROP TRIGGER fixture_state_activity_abort').run()
 await db.prepare(`INSERT INTO "Upload"(id,family_id,filename,content_type,size_bytes) VALUES ('state-photo','state-a','0123456789abcdef.png','image/png',100),('state-foreign-photo','state-b','fedcba9876543210.png','image/png',100)`).run()
 await seed('state-photo-task')
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-photo-task',photoUrl:'fedcba9876543210.png'},options)).status===400,'foreign upload cannot be attached')
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-photo-task',photoUrl:'https://example.test/picture.png'},options)).status===400,'arbitrary photo URLs refused')
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-photo-task',photoUrl:'0123456789abcdef.png'},options)).completed&&(await row('state-photo-task'))?.photo_url==='/api/files/chores/0123456789abcdef.png','owned upload normalized and unverified')
 function racing(sql:string):D1Store{let changed=false;return{prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),async batch(statements){if(!changed){changed=true;await db.prepare(sql).run()}return session.batch(statements)}}}}}
 await seed('state-revoked')
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-revoked'},{now,database:racing(`UPDATE "User" SET token_version=1 WHERE id='state-teen'`)})).status===401&&(await row('state-revoked'))?.status==='pending','revocation immediately before batch prevents effect')
 await db.prepare(`UPDATE "User" SET token_version=0 WHERE id='state-teen'`).run()
 await seed('state-photo-race')
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-photo-race',photoUrl:'0123456789abcdef.png'},{now,database:racing(`DELETE FROM "Upload" WHERE id='state-photo'`)})).status===400&&(await row('state-photo-race'))?.status==='pending','deleted upload cannot pass stale ownership preflight')
 await seed('state-verified-race');await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-verified-race'},options)
 check((await transitionD1AccountChore(teen,{kind:'undo',choreId:'state-verified-race'},{now,database:racing(`UPDATE "Chore" SET status='verified' WHERE id='state-verified-race'`)})).status===409&&(await row('state-verified-race'))?.status==='verified','Undo cannot overwrite a competing parent verification')
 await db.prepare(`INSERT INTO "HouseholdMember"(id,family_id,name,role,age) VALUES ('state-member','state-a','Mapped teen','teen',15),('state-profile','state-a','Young child','child',3)`).run()
 await db.prepare(`INSERT INTO "HouseholdMemberAccountLink"(member_id,user_id,family_id,verified_at) VALUES ('state-member','state-teen','state-a',?1)`).bind(now.getTime()).run()
 await seed('state-mapped');await db.prepare(`UPDATE "Chore" SET assigned_member_id='state-member' WHERE id='state-mapped'`).run()
 await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-mapped'},options)
 await db.prepare(`UPDATE "HouseholdMember" SET archived_at=?1 WHERE id='state-member'`).bind(Date.now()).run()
 let identityRefused=false;try{await transitionD1AccountChore(teen,{kind:'undo',choreId:'state-mapped'},options)}catch(cause){identityRefused=cause instanceof HouseholdMemberIdentityConflict}
 check(identityRefused&&(await row('state-mapped'))?.status==='completed','inactive canonical assignee cannot be silently rebound during Undo')
 await seed('state-profile-task');await db.prepare(`UPDATE "Chore" SET assigned_to=NULL,assigned_member_id='state-profile' WHERE id='state-profile-task'`).run()
 check((await transitionD1AccountChore(parent,{kind:'complete',choreId:'state-profile-task'},options)).status===409,'profile-only work retains its explicit device/profile protocol')
 await seed('state-foreign-task');await db.prepare(`UPDATE "Chore" SET family_id='state-b',assigned_to='state-other',created_by='state-other' WHERE id='state-foreign-task'`).run()
 check((await transitionD1AccountChore(teen,{kind:'complete',choreId:'state-foreign-task'},options)).status===403,'foreign chore refused')
 let rewind=false;try{await db.prepare(`UPDATE "Chore" SET preparation_epoch=0 WHERE id='state-once'`).run()}catch{rewind=true}check(rewind,'completion epoch cannot rewind')
 const xp=await db.prepare(`SELECT xp FROM "User" WHERE id='state-teen'`).first<{xp:number}>();check(xp?.xp===0,'completion and Undo never award XP')
 return{completeRace:8,undoRace:8,oneActivity:true,completionEpoch:true,anyMemberCompletion:true,assigneeOnlyUndo:true,legacySuccessor:true,seriesAtomicTopUp:true,atomicRollback:true,photoOwnership:true,authorityAndUploadRaces:true,verifiedUndoConflict:true,canonicalAssigneeRefusal:true,profileProtocol:true,foreignRefusal:true,noXp:true,pausedRoutineRefusal:true}
}
