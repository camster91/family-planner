import { assistantSourceGuard, AssistantSourceRefused, issueAssistantSourceProof } from '../../../src/lib/assistant-source-proof'
import { referenceAssistantToday, type AssistantSourceRow } from '../../../src/lib/assistant-references'
import { loadD1AssistantTodayContext } from '../../../src/lib/cloudflare/assistant-context'
import { mutateD1Event } from '../../../src/lib/cloudflare/event-mutations'
import { captureD1Reads } from '../../../src/lib/cloudflare/read-witness'
import type { NativeD1 } from '../../../src/lib/cloudflare/read-client'
import { normalizeFeatures } from '../../../src/lib/features'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
async function refused(operation: () => unknown) {
  try { await operation() } catch (cause) { check(cause instanceof AssistantSourceRefused, `Expected source refusal: ${cause instanceof Error ? cause.message : 'unknown'}`); return }
  throw new Error('Stale source was accepted')
}
export async function testAssistantSource(db: D1Store) {
  process.env.JWT_SECRET = 'fabricated-assistant-source-key-not-a-real-secret'
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY = '1'
  process.env.FAMILY_ASSISTANT_REFERENCES_READY = '1'
  process.env.ASSISTANT_TODAY_ENABLED = '1'
  const native = db as unknown as NativeD1
  const now = new Date(), day = Date.parse(`${now.toISOString().slice(0,10)}T00:00:00Z`)
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code,features) VALUES ('proof-a','Fixture','proof-a',?1),('proof-b','Other','proof-b',?1)`)
    .bind(JSON.stringify({ calendar: true, chores: true, meals: true, lists: true, inventory: true })).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role) VALUES
    ('proof-parent','proof-parent@example.test','Parent','proof-a','parent'),
    ('proof-teen','proof-teen@example.test','Teen','proof-a','teen'),
    ('proof-other','proof-other@example.test','Other','proof-b','parent')`).run()
  await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by) VALUES ('proof-event','proof-a','Outing',?1,?2,'proof-parent')`).bind(day+3600000,day+7200000).run()
  await db.prepare(`INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_to) VALUES ('proof-chore','proof-a','Chore',?1,'proof-parent','proof-teen')`).bind(day).run()
  await db.prepare(`INSERT INTO "Recipe" (id,family_id,title,prep_time,created_by) VALUES ('proof-recipe','proof-a','Soup',15,'proof-parent')`).run()
  await db.prepare(`INSERT INTO "FamilyMeal" (id,family_id,date,meal_type,recipe_id,cook_id,created_by) VALUES ('proof-dinner','proof-a',?1,'dinner','proof-recipe','proof-parent','proof-parent')`).bind(day).run()
  await db.prepare(`INSERT INTO "List" (id,family_id,name,type,created_by) VALUES ('proof-list','proof-a','Groceries','grocery','proof-parent')`).run()
  await db.prepare(`INSERT INTO "ListItem" (id,list_id,content,quantity,added_by) VALUES ('proof-item','proof-list',?1,3,'proof-parent')`).bind('Apples "red"\n🍎').run()
  await db.prepare(`INSERT INTO "InventoryItem" (id,family_id,name,expires_on,amount,added_by) VALUES ('proof-inventory','proof-a','Milk',?1,1,'proof-parent')`).bind(day+86400000).run()
  const actor = { userId: 'proof-parent', familyId: 'proof-a', role: 'parent', generation: 0, name: 'Parent' }
  const input = { title: 'Tomorrow outing', start_time: new Date(day+2*86400000+3600000).toISOString(), end_time: new Date(day+2*86400000+7200000).toISOString(), event_type: 'family' as const }
  const create = { kind: 'create' as const, input }
  const issue = async (owner = actor, observed = new Date()) => {
    let rows: AssistantSourceRow[] = []
    const load = { ...owner, serverNow: observed, viewerTimeZone: 'UTC', surface: 'person' as const, materializeSeries: false, onSources(sources: AssistantSourceRow[]) { rows = sources } }
    const context = await loadD1AssistantTodayContext(load, native)
    const snapshot = referenceAssistantToday(context, rows, load)
    const family = await db.prepare('SELECT features FROM "Family" WHERE id=?1').bind(owner.familyId).first<{features:string}>()
    check(snapshot && family, 'signed source projection exists')
    const proofOwner = {userId:owner.userId,familyId:owner.familyId,role:owner.role,generation:owner.generation}
    const proof = issueAssistantSourceProof(proofOwner, 'event_create', snapshot.context, snapshot.catalog, normalizeFeatures(JSON.parse(family.features)))
    return assistantSourceGuard({ headers: new Headers({ 'X-Assistant-Source-Proof': proof }) }, proofOwner, 'event_create')!
  }
  // A captured projection checks its exact native read values, including empty
  // sets and strings with quotes/newlines/Unicode, in the eventual atomic batch.
  const witness = await captureD1Reads(client => client.listItem.findMany({where:{list_id:'proof-list'},select:{content:true,quantity:true},orderBy:{id:'asc'}}), native)
  check(witness.value[0]?.quantity === 3, 'witness actual typed projection')
  await db.batch(witness.checks(db))
  const guard = await issue()
  const results = await Promise.all(Array.from({length:8}, () => mutateD1Event(actor, create, 'proof-create-eight', {database:db, sourceGuard:guard})))
  check(results.every(r=>r.status===200) && results.filter(r=>r.created).length===1 && results.filter(r=>r.replayed).length===7, 'eight signed confirmations commit once')
  const count = async () => (await db.prepare(`SELECT count(*) AS n FROM "Event" WHERE family_id='proof-a'`).first<{n:number}>())!.n
  const before = await count()
  const changes = [
    `UPDATE "Event" SET title='Changed outing' WHERE id='proof-event'`,
    `UPDATE "Chore" SET title='Changed chore' WHERE id='proof-chore'`,
    `UPDATE "Recipe" SET prep_time=20 WHERE id='proof-recipe'`,
    `UPDATE "User" SET name='Changed cook' WHERE id='proof-parent'`,
    `UPDATE "ListItem" SET quantity=4 WHERE id='proof-item'`,
    `UPDATE "InventoryItem" SET name='Changed inventory' WHERE id='proof-inventory'`,
    `UPDATE "Family" SET features=json_set(features,'$.calendar',json('false')) WHERE id='proof-a'`,
  ]
  for (let i=0;i<changes.length;i++) {
    const sourceGuard = await issue()
    await db.prepare(changes[i]).run()
    await refused(()=>mutateD1Event(actor,create,`proof-stale-${i}`,{database:db,sourceGuard}))
    check(await count()===before, 'stale source causes no effect')
  }
  await db.prepare(`UPDATE "Family" SET features=json_set(features,'$.calendar',json('true')) WHERE id='proof-a'`).run()
  const racingGuard = await issue()
  let raced = false
  const racing: D1Store = { prepare:db.prepare.bind(db), batch:db.batch.bind(db), withSession() {
    const session=db.withSession('first-primary')
    return {prepare:session.prepare.bind(session),async batch(statements) {
      if(!raced){raced=true;await db.prepare(`UPDATE "ListItem" SET content='Changed after verification' WHERE id='proof-item'`).run()}
      return session.batch(statements)
    }}
  }}
  await refused(()=>mutateD1Event(actor,create,'proof-batch-race',{database:racing,sourceGuard:racingGuard}))
  check(raced && await count()===before && !await db.prepare(`SELECT id FROM "IdempotencyRecord" WHERE key='proof-batch-race'`).first(), 'atomic source race rolls back effect and receipt')
  // An empty source window must remain empty through commit, not just during
  // the proof check. A changed nested recipe must also be observed atomically.
  for (const [label, sql] of [
    ['nested', `UPDATE "Recipe" SET prep_time=21 WHERE id='proof-recipe'`],
    ['empty', `INSERT INTO "Chore" (id,family_id,title,due_date,created_by,assigned_to) VALUES ('proof-new-chore','proof-a','New chore',${day},'proof-parent','proof-teen')`],
  ]) {
    if (label==='empty') await db.prepare(`DELETE FROM "Chore" WHERE family_id='proof-a'`).run()
    const sourceGuard=await issue()
    let intervened=false
    const concurrent:D1Store={prepare:db.prepare.bind(db),batch:db.batch.bind(db),withSession(){
      const session=db.withSession('first-primary')
      return {prepare:session.prepare.bind(session),async batch(statements){
        if(!intervened){intervened=true;await db.prepare(sql).run()}
        return session.batch(statements)
      }}
    }}
    await refused(()=>mutateD1Event(actor,create,`proof-${label}-race`,{database:concurrent,sourceGuard}))
    check(intervened && await count()===before,'nested/empty-window batch race refused')
  }
  const emptyGuard=await issue()
  await db.prepare(`INSERT INTO "ListItem" (id,list_id,content,added_by) VALUES ('proof-new-item','proof-list','New grocery','proof-parent')`).run()
  await refused(()=>mutateD1Event(actor,create,'proof-new-source',{database:db,sourceGuard:emptyGuard}))
  const expired=await issue(actor,new Date(Date.now()-120000))
  await refused(()=>mutateD1Event(actor,create,'proof-expired',{database:db,sourceGuard:expired}))
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY='0'
  check((await mutateD1Event(actor,create,'proof-create-eight',{database:db,sourceGuard:expired})).replayed,'completed replay needs current authority, not a fresh lease or enabled gates')
  process.env.FAMILY_ASSISTANT_CONFIRMATION_READY='1'
  const teen={...actor,userId:'proof-teen',role:'teen',name:'Teen'}
  check((await mutateD1Event(teen,create,'proof-teen-create',{database:db,sourceGuard:await issue(teen)})).created,'teen signed projection retains canonical creation right')
  const revoked=await issue()
  await db.prepare(`UPDATE "User" SET token_version=1 WHERE id='proof-parent'`).run()
  await refused(()=>mutateD1Event(actor,create,'proof-create-eight',{database:db,sourceGuard:revoked}))
  await db.prepare(`UPDATE "User" SET token_version=0,role='teen' WHERE id='proof-parent'`).run()
  await refused(()=>mutateD1Event(actor,create,'proof-create-eight',{database:db,sourceGuard:revoked}))
  await db.prepare(`UPDATE "User" SET role='parent',family_id='proof-b' WHERE id='proof-parent'`).run()
  await refused(()=>mutateD1Event(actor,create,'proof-create-eight',{database:db,sourceGuard:revoked}))
  return {signedCreateRace:8,sourceDomains:5,nestedRecipeAndCook:true,featureGates:true,atomicSourceRace:true,nestedAndEmptyBatchRaces:true,insertedSource:true,expiredRefusal:true,completedReplay:true,teenCreate:true,renewedAuthority:true,unicodeWitness:true}
}
