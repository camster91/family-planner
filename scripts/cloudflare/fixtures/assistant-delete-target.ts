import { assistantSourceGuard, AssistantSourceRefused, issueAssistantSourceProof } from '../../../src/lib/assistant-source-proof'
import { referenceAssistantToday, type AssistantSourceRow } from '../../../src/lib/assistant-references'
import { assistantDeleteTargetGuard, issueDeleteTargetProof } from '../../../src/lib/assistant-delete-target'
import { reviewD1EventDeleteTarget, readD1EventDeleteSnapshot } from '../../../src/lib/cloudflare/assistant-delete-target'
import { loadD1AssistantTodayContext } from '../../../src/lib/cloudflare/assistant-context'
import { withD1ReadClient, type NativeD1 } from '../../../src/lib/cloudflare/read-client'
import { mutateD1Event } from '../../../src/lib/cloudflare/event-mutations'
import { normalizeFeatures } from '../../../src/lib/features'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refused(operation: () => unknown) {
  try { await operation() } catch (cause) { check(cause instanceof AssistantSourceRefused, `Expected target refusal: ${cause instanceof Error ? cause.message : 'unknown'}`); return }
  throw new Error('Changed target was accepted')
}
export async function testAssistantDeleteTarget(db: D1Store) {
  let stage='seed'
  try {
  process.env.JWT_SECRET='fabricated-delete-target-key-not-a-real-secret'
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY='1'
  process.env.FAMILY_ASSISTANT_REFERENCES_READY='1'
  process.env.ASSISTANT_TODAY_ENABLED='1'
  const native=db as unknown as NativeD1
  const now=new Date(), day=Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')
  const features={calendar:true,chores:false,meals:false,lists:false,inventory:false}
  await db.prepare(`INSERT INTO "Family"(id,name,invite_code,features) VALUES ('target-a','Fixture','target-a',?1),('target-b','Other','target-b',?1)`).bind(JSON.stringify(features)).run()
  await db.prepare(`INSERT INTO "User"(id,email,name,family_id,role) VALUES ('target-parent','target-parent@example.test','Parent','target-a','parent'),('target-teen','target-teen@example.test','Teen','target-a','teen'),('target-other','target-other@example.test','Other','target-b','parent')`).run()
  await db.prepare(`INSERT INTO "CalendarConnection"(id,family_id,user_id,provider) VALUES ('target-connection','target-a','target-parent','google'),('target-foreign-connection','target-b','target-other','google')`).run()
  const actor={userId:'target-parent',familyId:'target-a',role:'parent',generation:0}
  const source=async(owner=actor)=>{
    let rows:AssistantSourceRow[]=[]
    const input={...owner,serverNow:new Date(),viewerTimeZone:'UTC',surface:'person' as const,materializeSeries:false,onSources(value:AssistantSourceRow[]){rows=value}}
    const context=await loadD1AssistantTodayContext(input,native),snapshot=referenceAssistantToday(context,rows,input)
    check(snapshot,'source context exists')
    const stored=await db.prepare('SELECT features FROM "Family" WHERE id=?1').bind(owner.familyId).first<{features:string}>()
    const token=issueAssistantSourceProof(owner,'event_delete',snapshot.context,snapshot.catalog,normalizeFeatures(JSON.parse(stored!.features)))
    return assistantSourceGuard({headers:new Headers({'X-Assistant-Source-Proof':token})},owner,'event_delete')!
  }
  const seed=async(id:string,children=true)=>{
    await db.prepare(`INSERT INTO "Event"(id,family_id,title,description,start_time,end_time,created_by) VALUES (?1,'target-a','Private target title','Details',?2,?3,'target-parent')`).bind(id,day+2*86400000+3600000,day+2*86400000+7200000).run()
    if(children){
      await db.prepare(`INSERT INTO "Chore"(id,family_id,title,created_by,assigned_to,due_date) VALUES (?1,'target-a','Preparation chore','target-parent','target-parent',?2)`).bind(id+'-chore',day).run()
      await db.prepare(`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES (?1,'target-a',?2,?3)`).bind(id+'-plan',id,'a'.repeat(64)).run()
      await db.prepare(`INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position) VALUES (?1,'target-a',?2,?3,0)`).bind(id+'-step',id+'-plan',id+'-chore').run()
      await db.prepare(`INSERT INTO "CalendarEventLink"(id,family_id,connection_id,event_id,external_id) VALUES (?1,'target-a','target-connection',?2,?1)`).bind(id+'-link',id).run()
    }
  }
  const review=async(id:string)=>{
    const sourceGuard=await source()
    const result=await reviewD1EventDeleteTarget(actor,id,sourceGuard,db)
    check(result.status===200 && result.body && 'target' in result.body,'target review success')
    const target=result.body.target!
    check(target.title==='Private target title' && target.detail===new Date(day+2*86400000+3600000).toISOString(),'canonical preview title and ISO date')
    const decoded=Buffer.from(target.proof.split('.')[1],'base64url').toString('utf8')
    check(!decoded.includes('Private target')&&!decoded.includes('Details'),'proof contains no target content')
    const targetGuard=assistantDeleteTargetGuard({headers:new Headers({'X-Assistant-Target-Proof':target.proof})},actor,'event_delete',id,true)!
    return {sourceGuard,targetGuard}
  }
  await seed('target-once')
  stage='initial review'
  const guards=await review('target-once')
  stage='initial delete race'
  const results=await Promise.all(Array.from({length:8},()=>mutateD1Event(actor,{kind:'delete',eventId:'target-once'},'target-delete-eight',{database:db,...guards})))
  check(results.every(r=>r.status===200)&&results.filter(r=>r.replayed).length===7,'eight confirmed deletes share one receipt')
  check(!await db.prepare(`SELECT id FROM "Event" WHERE id='target-once'`).first()&&!await db.prepare(`SELECT id FROM "EventPreparation" WHERE id='target-once-plan'`).first()&&!await db.prepare(`SELECT id FROM "EventPreparationStep" WHERE id='target-once-step'`).first(),'event and preparation cascade removed')
  check((await db.prepare(`SELECT event_id FROM "CalendarEventLink" WHERE id='target-once-link'`).first<{event_id:string|null}>())?.event_id===null,'calendar link retains deletion tombstone')
  check(await db.prepare(`SELECT id FROM "Chore" WHERE id='target-once-chore'`).first(),'preparation chore retained')
  const staleSql=[
    `UPDATE "Event" SET description='Changed details' WHERE id='target-stale'`,
    `UPDATE "Event" SET updated_at=updated_at+1 WHERE id='target-stale'`,
    `UPDATE "EventPreparation" SET revision=revision+1 WHERE id='target-stale-plan'`,
    `UPDATE "EventPreparationStep" SET position=1 WHERE id='target-stale-step'`,
    `UPDATE "CalendarEventLink" SET external_etag='Changed' WHERE id='target-stale-link'`,
  ]
  await seed('target-stale')
  for(let i=0;i<staleSql.length;i++){
    stage=`stale review ${i}`
    const current=await review('target-stale')
    await db.prepare(staleSql[i]).run()
    await refused(()=>mutateD1Event(actor,{kind:'delete',eventId:'target-stale'},`target-stale-${i}`,{database:db,...current}))
  }
  for(const [label,sql] of [
    ['root',`UPDATE "Event" SET location='Changed after verification' WHERE id='target-stale'`],
    ['child',`UPDATE "EventPreparationStep" SET position=2 WHERE id='target-stale-step'`],
    ['empty',`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES ('target-empty-new','target-a','target-empty','${'b'.repeat(64)}')`],
  ]){
    if(label==='empty')await seed('target-empty',false)
    const id=label==='empty'?'target-empty':'target-stale',current=await review(id)
    let raced=false
    const racing:D1Store={prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){const session=db.withSession('first-primary');return{prepare:session.prepare.bind(session),async batch(statements){if(!raced){raced=true;await db.prepare(sql).run()}return session.batch(statements)}}}}
    await refused(()=>mutateD1Event(actor,{kind:'delete',eventId:id},`target-${label}-race`,{database:racing,...current}))
    check(raced&&await db.prepare('SELECT id FROM "Event" WHERE id=?1').bind(id).first()&&!await db.prepare('SELECT id FROM "IdempotencyRecord" WHERE key=?1').bind(`target-${label}-race`).first(),'target race leaves event and no receipt')
  }
  stage='receipt rollback'
  await seed('target-rollback')
  const rollback=await review('target-rollback')
  await db.prepare(`CREATE TRIGGER fixture_target_receipt_abort BEFORE INSERT ON "IdempotencyRecord" WHEN NEW.key='target-rollback-key' BEGIN SELECT RAISE(ABORT,'fixture refusal'); END`).run()
  let aborted=false
  try { await mutateD1Event(actor,{kind:'delete',eventId:'target-rollback'},'target-rollback-key',{database:db,...rollback}) } catch { aborted=true }
  check(aborted&&await db.prepare(`SELECT id FROM "Event" WHERE id='target-rollback'`).first()&&await db.prepare(`SELECT id FROM "EventPreparationStep" WHERE id='target-rollback-step'`).first()&&(await db.prepare(`SELECT event_id FROM "CalendarEventLink" WHERE id='target-rollback-link'`).first<{event_id:string}>())?.event_id==='target-rollback','receipt failure restores event, preparation and linked tombstone state')
  await db.prepare('DROP TRIGGER fixture_target_receipt_abort').run()
  stage='imported and foreign targets'
  await seed('target-imported',false)
  await db.prepare(`INSERT INTO "CalendarSubscription"(id,family_id,created_by,name,url_enc) VALUES ('target-source','target-a','target-parent','Fixture','opaque-fixture')`).run()
  await db.prepare(`UPDATE "Event" SET source_subscription_id='target-source' WHERE id='target-imported'`).run()
  check((await reviewD1EventDeleteTarget(actor,'target-imported',await source(),db)).status===409,'imported target retains read-only policy')
  await db.prepare(`INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES ('target-foreign','target-b','PRIVATE FOREIGN',?1,?2,'target-other')`).bind(day+2*86400000,day+2*86400000+3600000).run()
  const foreignSource=await source()
  await refused(()=>reviewD1EventDeleteTarget(actor,'target-foreign',foreignSource,db))
  stage='bounded dependent set'
  await seed('target-cap',false)
  await db.prepare(`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source) VALUES ('target-cap-plan','target-a','target-cap','${'c'.repeat(64)}')`).run()
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<501)
    INSERT INTO "Chore"(id,family_id,title,created_by,assigned_to,due_date) SELECT 'target-cap-chore-'||x,'target-a','Fixture','target-parent','target-parent',?1 FROM n`).bind(day).run()
  await db.prepare(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<501)
    INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position) SELECT 'target-cap-step-'||x,'target-a','target-cap-plan','target-cap-chore-'||x,x FROM n`).run()
  const cappedSource=await source()
  await refused(()=>reviewD1EventDeleteTarget(actor,'target-cap',cappedSource,db))
  stage='expired target'
  const snapshot=await withD1ReadClient(client=>readD1EventDeleteSnapshot(client,actor.familyId,'target-stale'),native)
  check(snapshot,'full snapshot exists')
  const expiredToken=issueDeleteTargetProof(actor,'event_delete','target-stale',snapshot,Date.now()-120000)
  const expired=assistantDeleteTargetGuard({headers:new Headers({'X-Assistant-Target-Proof':expiredToken})},actor,'event_delete','target-stale',true)!
  await refused(()=>mutateD1Event(actor,{kind:'delete',eventId:'target-stale'},'target-expired',{database:db,targetGuard:expired}))
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY='0'
  check((await mutateD1Event(actor,{kind:'delete',eventId:'target-once'},'target-delete-eight',{database:db,...guards})).replayed,'completed missing-target replay needs no fresh source/target or gate')
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY='1'
  const unreviewedSource=await source()
  await refused(()=>mutateD1Event(actor,{kind:'delete',eventId:'target-stale'},'target-no-review',{database:db,sourceGuard:unreviewedSource}))
  stage='teen review'
  const teen={...actor,userId:'target-teen',role:'teen'}
  check((await reviewD1EventDeleteTarget(teen,'target-stale',await source(teen),db)).status===403,'teen cannot preview parent deletion')
  stage='foreign review'
  const current=await review('target-stale')
  await db.prepare(`INSERT INTO "CalendarEventLink"(id,family_id,connection_id,event_id,external_id) VALUES ('target-foreign-link','target-b','target-foreign-connection','target-stale','foreign')`).run()
  await refused(()=>reviewD1EventDeleteTarget(actor,'target-stale',current.sourceGuard,db))
  await refused(()=>mutateD1Event(actor,{kind:'delete',eventId:'target-stale'},'target-foreign-link',{database:db,...current}))
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='target-parent'`).run()
  check((await mutateD1Event(actor,{kind:'delete',eventId:'target-once'},'target-delete-eight',{database:db,targetGuard:guards.targetGuard})).status===401,'revoked target-only completed replay refused')
  stage='result'
  return {exactPreview:true,contentFreeProof:true,deleteRace:8,cascadeAndTombstone:true,retainedChore:true,receiptCascadeRollback:true,importedAndForeignTargets:true,childCap501:true,rootPlanStepLinkChanges:true,atomicRootChildAndEmptyRaces:true,expiredRefusal:true,completedReplay:true,sourceRequiresTarget:true,teenRefusal:true,foreignLinkRefusal:true,revokedReplay:true}
  } catch(cause) { throw new Error(`${stage}: ${cause instanceof Error ? cause.stack : 'unknown fixture failure'}`) }
}
