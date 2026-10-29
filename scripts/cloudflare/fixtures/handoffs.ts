import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  createD1Handoff,
  deleteD1Handoff,
  readD1Handoffs,
  readD1PublicHandoff,
  regenerateD1HandoffToken,
  updateD1Handoff,
} from "../../../src/lib/cloudflare/handoffs";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parent = {
  userId: "handoff-parent",
  familyId: "handoff-family-a",
  role: "parent",
  generation: 0,
} as const;
const teen = {
  userId: "handoff-teen",
  familyId: "handoff-family-a",
  role: "teen",
  generation: 0,
} as const;
const child = {
  userId: "handoff-child",
  familyId: "handoff-family-a",
  role: "child",
  generation: 0,
} as const;
const foreign = {
  userId: "handoff-foreign",
  familyId: "handoff-family-b",
  role: "parent",
  generation: 0,
} as const;

const createInput = {
  sitter_name: "Fabricated sitter",
  sitter_phone: "555-0100",
  arrival_time: "2026-10-28T18:00:00.000Z",
  departure_time: "2026-10-28T23:00:00.000Z",
  kids_bedtimes: "8pm",
  where_snacks: "pantry",
  pickup_authorized: "Grandma",
  code_words: "pineapple",
  pet_care: "feed cat",
  emergency_notes: "call parent",
  house_notes: "lock the back door",
  general_notes: "Fabricated fixture only",
} as const;

/** Native D1 household scope, role projections, receipts, source epochs and
 * public-token expiry for the sitter handoff surface. No external link is
 * submitted; the public read uses only the fabricated token in this D1 DB. */
export async function testHandoffs(db: D1Store) {
  const features = JSON.stringify({ handoff: true });
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES
          ('handoff-family-a','Handoff A','handoff-code-a',?1),
          ('handoff-family-b','Handoff B','handoff-code-b',?1)`,
      )
      .bind(features),
    db.prepare(
      `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
        ('handoff-parent','handoff-parent@example.test','Parent','parent','handoff-family-a',1,0),
        ('handoff-teen','handoff-teen@example.test','Teen','teen','handoff-family-a',1,0),
        ('handoff-child','handoff-child@example.test','Child','child','handoff-family-a',1,0),
        ('handoff-foreign','handoff-foreign@example.test','Foreign','parent','handoff-family-b',1,0)`,
    ),
  ]);

  const created = await createD1Handoff(
    parent,
    createInput,
    "handoff-create-receipt-0001",
    db,
  );
  check(created.status === 201 && !created.replayed, "handoff create");
  const handoff = (created.body as any).handoff;
  check(handoff.family_id === parent.familyId, "handoff family scope");
  check(typeof handoff.share_token === "string", "handoff token");
  const replay = await createD1Handoff(
    parent,
    createInput,
    "handoff-create-receipt-0001",
    db,
  );
  check(
    replay.status === 201 && replay.replayed,
    "handoff create receipt replay",
  );

  const listedParent = await readD1Handoffs(parent, db);
  check(
    listedParent.status === 200 &&
      (listedParent.body as any).handoffs.length === 1 &&
      (listedParent.body as any).handoffs[0].share_token ===
        handoff.share_token,
    "parent handoff projection",
  );
  const listedTeen = await readD1Handoffs(teen, db);
  check(
    listedTeen.status === 200 &&
      !(listedTeen.body as any).handoffs[0].share_token &&
      !(listedTeen.body as any).handoffs[0].share_expires_at &&
      (listedTeen.body as any).handoffs[0].code_words === "pineapple",
    "teen handoff projection",
  );
  const listedChild = await readD1Handoffs(child, db);
  check(
    listedChild.status === 200 &&
      JSON.stringify((listedChild.body as any).handoffs[0]) ===
        JSON.stringify({
          id: handoff.id,
          sitter_name: "Fabricated sitter",
          arrival_time: handoff.arrival_time,
          departure_time: handoff.departure_time,
        }),
    "child handoff projection",
  );
  check(
    (await readD1Handoffs(foreign, db)).status === 200 &&
      (await readD1Handoffs(foreign, db)).body !== undefined,
    "foreign handoff isolation",
  );

  const updated = await updateD1Handoff(
    parent,
    handoff.id,
    { house_notes: "Updated only in fabricated D1" },
    "handoff-update-receipt-0001",
    db,
  );
  check(
    updated.status === 200 &&
      (updated.body as any).handoff.house_notes ===
        "Updated only in fabricated D1",
    "handoff update source guard",
  );
  const updateReplay = await updateD1Handoff(
    parent,
    handoff.id,
    { house_notes: "Updated only in fabricated D1" },
    "handoff-update-receipt-0001",
    db,
  );
  check(updateReplay.replayed === true, "handoff update receipt replay");

  const rotated = await regenerateD1HandoffToken(
    parent,
    handoff.id,
    "handoff-rotate-receipt-0001",
    db,
  );
  const rotatedToken = (rotated.body as any).handoff.share_token;
  check(
    rotated.status === 200 && rotatedToken !== handoff.share_token,
    "handoff token rotation",
  );
  const publicRead = await readD1PublicHandoff(rotatedToken, db);
  check(
    publicRead.status === 200 &&
      (publicRead.body as any).handoff.family.name === "Handoff A" &&
      !(publicRead.body as any).handoff.share_token &&
      !(publicRead.body as any).handoff.family_id,
    "public token projection",
  );
  check(
    (await readD1PublicHandoff("missing-handoff-token", db)).status === 404,
    "unknown public token",
  );
  check(
    (await deleteD1Handoff(foreign, handoff.id, null, db)).status === 404,
    "foreign delete refused",
  );
  check(
    (await readD1Handoffs({ ...parent, generation: 1 }, db)).status === 401,
    "stale handoff session refused",
  );

  return {
    handoffRead: true,
    handoffRoles: true,
    handoffCreateReceipt: true,
    handoffUpdateReceipt: true,
    handoffSourceGuard: true,
    handoffRotation: true,
    handoffPublicScope: true,
    householdIsolation: true,
  };
}
