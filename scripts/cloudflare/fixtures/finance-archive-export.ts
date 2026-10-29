import {
  readD1FinanceArchiveDetails,
  readD1FinanceArchivePage,
  readD1ImportJobs,
} from "../../../src/lib/cloudflare/finance-archive";
import { readD1UserExport } from "../../../src/lib/cloudflare/user-export";
import type { D1Store } from "../../../src/lib/cloudflare/database";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parent = {
  userId: "archive-parent-a",
  familyId: "archive-family-a",
  role: "parent",
  generation: 0,
} as const;
const teen = {
  userId: "archive-teen-a",
  familyId: "archive-family-a",
  role: "teen",
  generation: 0,
} as const;
const child = {
  userId: "archive-child-a",
  familyId: "archive-family-a",
  role: "child",
  generation: 0,
} as const;
const foreign = {
  userId: "archive-parent-b",
  familyId: "archive-family-b",
  role: "parent",
  generation: 0,
} as const;
const loner = {
  userId: "archive-loner",
  familyId: null,
  role: "parent",
  generation: 0,
} as const;
const features = JSON.stringify({
  budget: true,
  chores: true,
  calendar: true,
  lists: true,
  family: true,
});
const stamp = Date.parse("2026-10-28T16:00:00.000Z");

function countedStore(database: D1Store) {
  let queries = 0;
  const wrap = (statement: any): any =>
    new Proxy(statement, {
      get(target, property, receiver) {
        if (property === "bind")
          return (...values: any[]) => wrap(target.bind(...values));
        if (property === "first" || property === "all" || property === "run") {
          return (...args: any[]) => {
            queries += 1;
            return Reflect.apply(target[property], target, args);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
  const counted: D1Store = {
    prepare(sql) {
      return wrap(database.prepare(sql));
    },
    batch(statements) {
      queries += 1;
      return database.batch(statements);
    },
    withSession() {
      return {
        prepare(sql: string) {
          return wrap(database.withSession("first-primary").prepare(sql));
        },
        batch(statements: any[]) {
          queries += 1;
          return database.withSession("first-primary").batch(statements);
        },
      };
    },
  };
  return {
    counted,
    get queries() {
      return queries;
    },
  };
}

/** Disposable proof for private archive/import and GDPR aggregate reads. */
export async function testFinanceArchiveExport(db: D1Store) {
  // The review switch is intentionally opt-in in production. This isolated
  // worker enables it only for this fabricated request scope.
  if (typeof process !== "undefined")
    process.env.FINANCE_ARCHIVE_REVIEW_ENABLED = "1";
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features,feed_token,capture_ai_key_enc,capture_ai_base_url) VALUES
      ('archive-family-a','Archive A','archive-code-a',?1,'feed-secret-a','v1:secret-a','https://provider-a.invalid'),
      ('archive-family-b','Archive B','archive-code-b',?1,'feed-secret-b','v1:secret-b','https://provider-b.invalid')`,
      )
      .bind(features),
    db.prepare(`INSERT INTO "User"(id,email,password,name,family_id,role,token_version,email_verified) VALUES
      ('archive-parent-a','archive-parent-a@example.test','password-secret-a','Archive Parent','archive-family-a','parent',0,1),
      ('archive-teen-a','archive-teen-a@example.test','password-secret-teen','Archive Teen','archive-family-a','teen',0,1),
      ('archive-child-a','archive-child-a@example.test','password-secret-child','Archive Child','archive-family-a','child',0,1),
      ('archive-parent-b','archive-parent-b@example.test','password-secret-b','Foreign Parent','archive-family-b','parent',0,1),
      ('archive-loner','archive-loner@example.test','password-secret-loner','Historical Loner',NULL,'parent',0,1)`),
    db
      .prepare(
        `INSERT INTO "ImportJob"(id,family_id,source_app,source_version,status,dry_run,started_by,started_at,completed_at,summary,error) VALUES
      ('archive-job-a','archive-family-a','budget-app','v1','completed',0,'archive-parent-a',?1,?1,'{"rows":1}',NULL),
      ('archive-job-b','archive-family-b','budget-app','v1','completed',0,'archive-parent-b',?1,?1,'{"rows":9}',NULL)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "ImportedRecord"(id,family_id,import_job_id,source_app,source_model,source_id,target_model,target_id,checksum,created_at) VALUES
      ('archive-imported-a','archive-family-a','archive-job-a','budget-app','accounts','acct-a','FinancialArchiveRecord','archive-record-a','checksum-a',?1),
      ('archive-imported-b','archive-family-b','archive-job-b','budget-app','accounts','acct-b','FinancialArchiveRecord','archive-record-b','checksum-b',?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "FinancialArchiveRecord"(id,family_id,source_app,source_model,source_id,payload,created_at) VALUES
      ('archive-record-a','archive-family-a','budget-app','accounts','acct-a','{"amount":123,"marker":"private-a"}',?1),
      ('archive-record-b','archive-family-b','budget-app','accounts','acct-b','{"amount":999,"marker":"foreign-b"}',?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "List"(id,family_id,name,type,created_by,created_at,updated_at) VALUES
      ('archive-list-a','archive-family-a','Archive groceries','grocery','archive-parent-a',?1,?1),
      ('archive-list-b','archive-family-b','Foreign groceries','grocery','archive-parent-b',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "ListItem"(id,list_id,content,added_by,created_at,updated_at) VALUES
      ('archive-item-a','archive-list-a','Private milk','archive-parent-a',?1,?1),
      ('archive-item-b','archive-list-b','Foreign milk','archive-parent-b',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "PinnedNote"(id,family_id,title,body,created_by,created_at,updated_at) VALUES
      ('archive-note-a','archive-family-a','Private note','Household A note','archive-parent-a',?1,?1),
      ('archive-note-b','archive-family-b','Foreign note','Household B note','archive-parent-b',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "Handoff"(id,family_id,sitter_name,sitter_phone,arrival_time,departure_time,code_words,share_token,share_expires_at,created_by,created_at,updated_at) VALUES
      ('archive-handoff-parent','archive-family-a','Parent sitter','555-0100',?1,?1,'parent secret words','share-token-parent',?1,'archive-parent-a',?1,?1),
      ('archive-handoff-teen','archive-family-a','Teen sitter','555-0101',?1,?1,'teen words','share-token-teen',?1,'archive-teen-a',?1,?1),
      ('archive-handoff-child','archive-family-a','Child sitter','555-0102',?1,?1,'child words','share-token-child',?1,'archive-child-a',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "PushSubscription"(id,family_id,user_id,endpoint,keys,created_at,updated_at) VALUES
      ('archive-push-a','archive-family-a','archive-parent-a','https://push.invalid/secret','{"p256dh":"p256dh-secret","auth":"auth-secret"}',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `UPDATE "User" SET weekly_reset_progress=?1,weekly_reset_revision=3 WHERE id='archive-parent-a'`,
      )
      .bind('{"week":"fixture","steps":{"meals":"reviewed"}}'),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,assigned_to,due_date,created_by) VALUES
      ('archive-prep-chore','archive-family-a','Pack school bag','archive-parent-a',?1,'archive-parent-a')`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "ChoreAssignment"(id,family_id,chore_id,assigned_to,due_date,idempotency_key) VALUES
      ('archive-assignment-a','archive-family-a','archive-prep-chore','archive-parent-a',?1,'assignment-request-secret')`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES
      ('archive-prep-event','archive-family-a','School departure',?1,?2,'archive-parent-a')`,
      )
      .bind(stamp, stamp + 3600000),
    db.prepare(`INSERT INTO "EventPreparation"(id,family_id,event_id,reviewed_event_source,revision) VALUES
      ('archive-prep-plan','archive-family-a','archive-prep-event','source-v1',2)`),
    db.prepare(`INSERT INTO "EventPreparationStep"(id,family_id,preparation_id,chore_id,position,cue_anchor,cue_direction,cue_minutes) VALUES
      ('archive-prep-step','archive-family-a','archive-prep-plan','archive-prep-chore',0,'event_start','before',15)`),
    db
      .prepare(
        `INSERT INTO "ResponsibilityState"(id,family_id,chore_id,source_token,revision,coordinator_id) VALUES
      ('archive-responsibility','archive-family-a','archive-prep-chore',?1,1,'archive-parent-a')`,
      )
      .bind("0000000000000000000000000000000000000000000000000000000000000000"),
    db.prepare(`INSERT INTO "AiUsagePolicy"(family_id,revision,enabled,daily_limit,user_daily_limit,monthly_budget_microusd,input_rate,output_rate) VALUES
      ('archive-family-a',4,1,20,5,1000000,10,20)`),
    db
      .prepare(
        `INSERT INTO "AiUsageRequest"(id,family_id,user_id,job,created_at,finished_at,outcome,provider_status,latency_ms,input_tokens,output_tokens) VALUES
      ('archive-ai-request-a','archive-family-a','archive-parent-a','assistant',?1,?1,'accepted','ok',120,10,20)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "NotificationEventOccurrence"(id,family_id,occurrence_key,envelope,created_at) VALUES
      ('archive-notification-event','archive-family-a',?1,'{"type":"chore.check","familyId":"archive-family-a"}',?2)`,
      )
      .bind(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        stamp,
      ),
    db
      .prepare(
        `INSERT INTO "NotificationRecipientDecision"(id,family_id,event_id,slot,user_id,status,quiet,created_at) VALUES
      ('archive-notification-slot','archive-family-a','archive-notification-event',0,'archive-parent-a','created',0,?1)`,
      )
      .bind(stamp),
    db.prepare(`INSERT INTO "InventoryItem"(id,family_id,name,amount,unit,added_by) VALUES
      ('archive-inventory-a','archive-family-a','Milk',1,'jug','archive-parent-a')`),
    db
      .prepare(
        `INSERT INTO "InventoryAdjustment"(id,family_id,item_id,kind,amount_delta,amount_before,amount_after,status_before,status_after,actor_id,request_id,item_version,created_at) VALUES
      ('archive-adjustment-a','archive-family-a','archive-inventory-a','consume',-1,1,0,'active','finished','archive-parent-a','inventory-request-secret',1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "GrocerySectionPreference"(id,family_id,name_key,section,updated_by,created_at,updated_at) VALUES
      ('archive-section-a','archive-family-a','milk','dairy','archive-parent-a',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "Pickup"(id,family_id,title,pickup_time,assigned_to,created_by) VALUES
      ('archive-pickup-a','archive-family-a','School pickup',?1,'archive-parent-a','archive-parent-a')`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "List"(id,family_id,name,type,created_by,created_at,updated_at) VALUES
      ('archive-loner-list','archive-family-b','Historical list','grocery','archive-loner',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "ListItem"(id,list_id,content,added_by,created_at,updated_at) VALUES
      ('archive-loner-item','archive-loner-list','Historical milk','archive-loner',?1,?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "Message"(id,family_id,sender_id,content,created_at) VALUES
      ('archive-loner-message','archive-family-b','archive-loner','Historical message',?1)`,
      )
      .bind(stamp),
    db
      .prepare(
        `INSERT INTO "Event"(id,family_id,title,start_time,end_time,created_by) VALUES
      ('archive-loner-event','archive-family-b','Historical event',?1,?2,'archive-loner')`,
      )
      .bind(stamp, stamp + 3600000),
    db.prepare(`INSERT INTO "Reward"(id,family_id,name,created_by,claimed_by) VALUES
      ('archive-loner-reward','archive-family-b','Historical reward','archive-loner','archive-loner')`),
    db.prepare(`INSERT INTO "Project"(id,family_id,name,created_by) VALUES
      ('archive-loner-project','archive-family-b','Historical project','archive-loner')`),
    db.prepare(`INSERT INTO "Activity"(id,family_id,user_id,type,title) VALUES
      ('archive-loner-activity','archive-family-b','archive-loner','history','Historical activity')`),
    db.prepare(`INSERT INTO "Transaction"(id,family_id,user_id,amount,type,description) VALUES
      ('archive-loner-transaction','archive-family-b','archive-loner',12.5,'expense','Historical transaction')`),
  ]);

  const page = await readD1FinanceArchivePage(
    parent,
    { model: null, cursor: null },
    db,
  );
  check(
    page.status === 200 && (page.body as any).rows.length === 1,
    "archive page stays in household",
  );
  check(
    (page.body as any).rows[0].sourceId === "acct-a" &&
      (page.body as any).counts.find((row: any) => row.model === "accounts")
        .count === "1",
    "archive metadata is bounded",
  );
  const detail = await readD1FinanceArchiveDetails(
    parent,
    "archive-record-a",
    db,
  );
  check(
    detail.status === 200 &&
      (detail.body as any).fingerprint.state === "available",
    "archive detail fingerprints payload",
  );
  check(
    (detail.body as any).provenance.state === "matched" &&
      (detail.body as any).provenance.sourceVersion === "v1",
    "archive provenance is matched",
  );
  check(
    (await readD1FinanceArchiveDetails(parent, "archive-record-b", db))
      .status === 404,
    "foreign archive detail is hidden",
  );
  check(
    (await readD1FinanceArchivePage(foreign, { model: null, cursor: null }, db))
      .status === 200,
    "foreign parent can read only own archive",
  );
  check(
    (await readD1FinanceArchivePage(teen, { model: null, cursor: null }, db))
      .status === 403,
    "teen cannot read archive review",
  );
  check(
    (await readD1FinanceArchivePage(child, { model: null, cursor: null }, db))
      .status === 403,
    "child cannot read archive review",
  );
  check(
    (
      await readD1FinanceArchivePage(
        { ...parent, generation: 1 },
        { model: null, cursor: null },
        db,
      )
    ).status === 409,
    "stale archive owner is refused",
  );
  await db
    .prepare(`UPDATE "Family" SET features=?1 WHERE id=?2`)
    .bind(JSON.stringify({ budget: false }), parent.familyId)
    .run();
  check(
    (await readD1FinanceArchivePage(parent, { model: null, cursor: null }, db))
      .status === 404,
    "archive feature gate is enforced",
  );
  await db
    .prepare(`UPDATE "Family" SET features=?1 WHERE id=?2`)
    .bind(features, parent.familyId)
    .run();

  const jobs = await readD1ImportJobs(parent, db);
  check(
    jobs.status === 200 &&
      (jobs.body as any).jobs.length === 1 &&
      (jobs.body as any).jobs[0].id === "archive-job-a",
    "import jobs stay in household",
  );
  check(
    (await readD1ImportJobs(teen, db)).status === 403 &&
      (await readD1ImportJobs(child, db)).status === 403,
    "import jobs stay parent-only",
  );

  const measured = countedStore(db);
  const parentExport = await readD1UserExport(parent, measured.counted);
  const parentExportQueries = measured.queries;
  check(parentExport.status === 200, "parent D1 export succeeds");
  check(
    parentExportQueries <= 50,
    `D1 export query budget exceeded: ${parentExportQueries}`,
  );
  const parentBody = parentExport.body as any;
  const serializedParent = JSON.stringify(parentBody);
  check(
    parentBody.lists.length === 1 &&
      parentBody.lists[0].items[0].content === "Private milk",
    "export list stays in household",
  );
  check(
    parentBody.financeArchive.length === 1 &&
      parentBody.importJobs.length === 1,
    "parent export includes private import records",
  );
  check(
    parentBody.weeklyReset?.revision === 3 &&
      parentBody.weeklyReset.progress?.week === "fixture",
    "export includes weekly reset state",
  );
  check(
    parentBody.aiUsage?.ownRequests.length === 1 &&
      parentBody.aiUsage.ownRequests[0].id === "archive-ai-request-a",
    "export includes own AI usage",
  );
  check(
    parentBody.aiUsage.currentHouseholdPolicy?.revision === 4 &&
      parentBody.aiUsage.currentHouseholdPolicy.monthly_budget_microusd ===
        "1000000",
    "export includes parent AI policy",
  );
  check(
    parentBody.eventPreparation?.length === 1 &&
      parentBody.eventPreparation[0].steps[0].chore_id ===
        "archive-prep-chore" &&
      !("reviewed_event_source" in parentBody.eventPreparation[0]),
    "export includes scoped event preparation without source token",
  );
  check(
    parentBody.responsibilityState?.length === 1 &&
      parentBody.responsibilityState[0].chore_id === "archive-prep-chore" &&
      !("source_token" in parentBody.responsibilityState[0]),
    "export includes scoped responsibility without source token",
  );
  check(
    parentBody.notificationEvents?.length === 1 &&
      parentBody.notificationEvents[0].recipient_decisions[0].slot === 0,
    "export includes parent notification evidence",
  );
  check(
    parentBody.inventoryAdjustments?.length === 1 &&
      !("request_id" in parentBody.inventoryAdjustments[0]),
    "export omits inventory request ids",
  );
  check(
    parentBody.grocerySectionPreferences?.length === 1 &&
      !("id" in parentBody.grocerySectionPreferences[0]),
    "export omits grocery preference ids",
  );
  check(
    parentBody.choreAssignments?.length === 1 &&
      !("idempotency_key" in parentBody.choreAssignments[0]) &&
      !("assigned_member_id" in parentBody.choreAssignments[0]) &&
      !("member_subject_erased" in parentBody.choreAssignments[0]),
    "export omits assignment internals",
  );
  check(
    parentBody.pickups?.length === 1 &&
      !("responsibility_generation" in parentBody.pickups[0]) &&
      !("responsibility_epoch" in parentBody.pickups[0]),
    "export omits pickup coordination internals",
  );
  const parentHandoff = parentBody.handoffs.find(
    (row: any) => row.id === "archive-handoff-parent",
  );
  check(
    parentHandoff?.share_expires_at &&
      !serializedParent.includes("share-token-parent"),
    "export redacts share token",
  );
  check(
    !serializedParent.includes("feed-secret-a") &&
      !serializedParent.includes("password-secret-a") &&
      !serializedParent.includes("push.invalid") &&
      !serializedParent.includes("inventory-request-secret") &&
      !serializedParent.includes("assignment-request-secret"),
    "export redacts credentials and endpoints",
  );
  check(
    !serializedParent.includes("Foreign") &&
      !serializedParent.includes("foreign-b"),
    "export excludes foreign household",
  );

  const teenExport = await readD1UserExport(teen, db);
  check(teenExport.status === 200, "teen D1 export succeeds");
  const teenHandoff = (teenExport.body as any).handoffs.find(
    (row: any) => row.id === "archive-handoff-teen",
  );
  check(
    teenHandoff &&
      teenHandoff.code_words === "teen words" &&
      !("share_expires_at" in teenHandoff),
    "teen handoff is role-shaped",
  );
  const childExport = await readD1UserExport(child, db);
  check(childExport.status === 200, "child D1 export succeeds");
  const childHandoff = (childExport.body as any).handoffs.find(
    (row: any) => row.id === "archive-handoff-child",
  );
  check(
    Object.keys(childHandoff).sort().join(",") ===
      "arrival_time,departure_time,id,sitter_name",
    "child handoff is minimized",
  );
  const lonerExport = await readD1UserExport(loner, db);
  check(lonerExport.status === 200, "no-family export succeeds");
  const lonerBody = lonerExport.body as any;
  check(
    lonerBody.lists.some(
      (row: any) =>
        row.id === "archive-loner-list" &&
        row.items[0]?.content === "Historical milk",
    ),
    "no-family export keeps own historical lists",
  );
  check(
    lonerBody.messages.some((row: any) => row.id === "archive-loner-message") &&
      lonerBody.events.some((row: any) => row.id === "archive-loner-event"),
    "no-family export keeps own historical messages and events",
  );
  check(
    lonerBody.rewards.some((row: any) => row.id === "archive-loner-reward") &&
      lonerBody.projects.some((row: any) => row.id === "archive-loner-project"),
    "no-family export keeps own historical rewards and projects",
  );
  check(
    lonerBody.activities.some(
      (row: any) => row.id === "archive-loner-activity",
    ) &&
      lonerBody.transactions.some(
        (row: any) => row.id === "archive-loner-transaction",
      ),
    "no-family export keeps own historical activity and transactions",
  );
  check(
    !JSON.stringify(lonerBody).includes("Foreign") &&
      !JSON.stringify(lonerBody).includes("Archive A"),
    "no-family export excludes unrelated households",
  );
  check(
    (await readD1UserExport({ userId: parent.userId, generation: 1 }, db))
      .status === 401,
    "stale export session is refused",
  );

  return {
    archive: true,
    importJobs: true,
    export: true,
    roleRedaction: true,
    householdIsolation: true,
    featureGate: true,
    parentExportQueries,
  };
}
