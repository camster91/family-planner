import type { D1Store } from "../../../src/lib/cloudflare/database";
import { readD1HouseholdSearch } from "../../../src/lib/cloudflare/search";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const features = JSON.stringify({
  chores: true,
  calendar: true,
  lists: true,
  family: true,
  meals: true,
  notes: true,
  inventory: true,
});

const parent = {
  userId: "search-native-parent",
  familyId: "search-native-family-a",
  role: "parent",
  generation: 0,
} as const;
const child = {
  userId: "search-native-child",
  familyId: "search-native-family-a",
  role: "child",
  generation: 0,
} as const;
const foreign = {
  userId: "search-native-foreign",
  familyId: "search-native-family-b",
  role: "parent",
  generation: 0,
} as const;

/** Disposable coverage for native search ordering, role gates, escaping and household isolation. */
export async function testSearch(db: D1Store) {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES
      ('search-native-family-a','Search A','search-native-code-a',?1),
      ('search-native-family-b','Search B','search-native-code-b',?1)`,
      )
      .bind(features),
    db.prepare(`INSERT INTO "User"(id,email,name,role,family_id,token_version,email_verified) VALUES
      ('search-native-parent','search-native-parent@example.test','Search Needle Parent','parent','search-native-family-a',0,1),
      ('search-native-child','search-native-child@example.test','Search Needle Child','child','search-native-family-a',0,1),
      ('search-native-foreign','search-native-foreign@example.test','Foreign Needle Parent','parent','search-native-family-b',0,1)`),
    db
      .prepare(
        `INSERT INTO "Event"(id,family_id,title,description,start_time,end_time,location,created_by) VALUES
      ('search-native-event','search-native-family-a','Needle appointment','Family event',?1,?1,'Needle room','search-native-parent'),
      ('search-native-foreign-event','search-native-family-b','Foreign Needle event',NULL,?1,?1,NULL,'search-native-foreign')`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO "Chore"(id,family_id,title,description,due_date,status,assigned_to,created_by) VALUES
      ('search-native-chore','search-native-family-a','Needle chore','Use the needle kit',?1,'pending','search-native-child','search-native-parent'),
      ('search-native-foreign-chore','search-native-family-b','Foreign Needle chore',NULL,?1,'pending','search-native-foreign','search-native-foreign')`,
      )
      .bind(now),
    db.prepare(`INSERT INTO "List"(id,family_id,name,type,description,created_by) VALUES
      ('search-native-list','search-native-family-a','Needle shopping','grocery','Needle supplies','search-native-parent'),
      ('search-native-foreign-list','search-native-family-b','Foreign Needle list','grocery',NULL,'search-native-foreign')`),
    db.prepare(`INSERT INTO "ListItem"(id,list_id,content,checked,added_by) VALUES
      ('search-native-item','search-native-list','Needle item',0,'search-native-parent'),
      ('search-native-foreign-item','search-native-foreign-list','Foreign Needle item',0,'search-native-foreign')`),
    db.prepare(`INSERT INTO "Recipe"(id,family_id,title,description,prep_time,created_by) VALUES
      ('search-native-recipe','search-native-family-a','Needle recipe','Needle ingredients',20,'search-native-parent'),
      ('search-native-foreign-recipe','search-native-family-b','Foreign Needle recipe',NULL,10,'search-native-foreign')`),
    db
      .prepare(
        `INSERT INTO "PinnedNote"(id,family_id,title,body,created_by,created_at,updated_at) VALUES
      ('search-native-note','search-native-family-a','Needle note','Private needle body','search-native-parent',?1,?1),
      ('search-native-foreign-note','search-native-family-b','Foreign Needle note','Foreign body','search-native-foreign',?1,?1)`,
      )
      .bind(now),
    db
      .prepare(
        `INSERT INTO "InventoryItem"(id,family_id,name,location,status,added_by,created_at,updated_at) VALUES
      ('search-native-inventory','search-native-family-a','Needle flour','pantry','active','search-native-parent',?1,?1),
      ('search-native-consumed','search-native-family-a','Needle consumed','fridge','consumed','search-native-parent',?1,?1),
      ('search-native-foreign-inventory','search-native-family-b','Foreign Needle flour','pantry','active','search-native-foreign',?1,?1)`,
      )
      .bind(now),
  ]);

  const parentResult = await readD1HouseholdSearch(parent, "needle", db);
  check(parentResult.status === 200, "parent search response");
  const parentRows = (parentResult.body as any).results as Array<{
    type: string;
    id: string;
    title: string;
    subtitle?: string;
  }>;
  check(
    new Set(parentRows.map((row) => row.type)).size === 8,
    "parent sees every enabled search type",
  );
  check(
    parentRows.every((row) => !row.id.includes("foreign")),
    "search stays in the household",
  );
  check(
    parentRows.some(
      (row) => row.type === "inventory" && row.id === "search-native-inventory",
    ),
    "active inventory is searchable",
  );
  check(
    !parentRows.some((row) => row.id === "search-native-consumed"),
    "consumed inventory is hidden",
  );
  check(
    !parentRows.some((row) => row.subtitle === "Private needle body"),
    "note body is not returned",
  );

  const childResult = await readD1HouseholdSearch(child, "needle", db);
  check(childResult.status === 200, "child search response");
  const childTypes = new Set(
    ((childResult.body as any).results as Array<{ type: string }>).map(
      (row) => row.type,
    ),
  );
  check(
    JSON.stringify([...childTypes].sort()) ===
      JSON.stringify(["inventory", "list", "list_item", "note"]),
    "child search follows page access",
  );

  const literal = await readD1HouseholdSearch(parent, "50%", db);
  check(
    literal.status === 200 && (literal.body as any).results.length === 0,
    "wildcard characters are literal",
  );
  const foreignResult = await readD1HouseholdSearch(foreign, "needle", db);
  check(
    foreignResult.status === 200 &&
      (foreignResult.body as any).results.every((row: any) =>
        row.id.includes("foreign"),
      ),
    "foreign actor sees only own household",
  );
  const stale = await readD1HouseholdSearch(
    { ...parent, generation: 1 },
    "needle",
    db,
  );
  check(stale.status === 401, "stale search actor refused");

  await db
    .prepare(`UPDATE "Family" SET features=?1 WHERE id=?2`)
    .bind(
      JSON.stringify({
        chores: true,
        calendar: true,
        lists: true,
        family: true,
        meals: true,
        notes: false,
        inventory: false,
      }),
      parent.familyId,
    )
    .run();
  const featureOff = await readD1HouseholdSearch(parent, "needle", db);
  check(
    featureOff.status === 200 &&
      !(featureOff.body as any).results.some(
        (row: any) => row.type === "note" || row.type === "inventory",
      ),
    "disabled search features are omitted",
  );

  return {
    search: true,
    roleGates: true,
    escaping: true,
    householdIsolation: true,
    staleGeneration: true,
    featureGates: true,
  };
}
