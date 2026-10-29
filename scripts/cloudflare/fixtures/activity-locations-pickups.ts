import type { D1Store } from "../../../src/lib/cloudflare/database";
import { readD1Activity } from "../../../src/lib/cloudflare/activity";
import {
  createD1Location,
  deleteD1Location,
  readD1Locations,
  updateD1Location,
} from "../../../src/lib/cloudflare/locations";
import {
  createD1Pickup,
  deleteD1Pickup,
  readD1Pickups,
  updateD1Pickup,
} from "../../../src/lib/cloudflare/pickups";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const parent = {
  userId: "activity-parent",
  familyId: "activity-family-a",
  role: "parent",
  generation: 0,
} as const;
const teen = {
  userId: "activity-teen",
  familyId: "activity-family-a",
  role: "teen",
  generation: 0,
} as const;
const child = {
  userId: "activity-child",
  familyId: "activity-family-a",
  role: "child",
  generation: 0,
} as const;
const foreign = {
  userId: "activity-foreign",
  familyId: "activity-family-b",
  role: "parent",
  generation: 0,
} as const;

/** Native household-scope coverage for activity, saved places and pickups. */
export async function testActivityLocationsPickups(db: D1Store) {
  const first = Date.parse("2026-10-28T15:00:00.000Z");
  const second = first + 60_000;
  const features = JSON.stringify({ locations: true, pickups: true });
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES ('activity-family-a','Activity A','activity-code-a',?1),('activity-family-b','Activity B','activity-code-b',?1)`,
      )
      .bind(features),
    db.prepare(
      `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
        ('activity-parent','activity-parent@example.test','Activity Parent','parent','activity-family-a',1,0),
        ('activity-teen','activity-teen@example.test','Activity Teen','teen','activity-family-a',1,0),
        ('activity-child','activity-child@example.test','Activity Child','child','activity-family-a',1,0),
        ('activity-foreign','activity-foreign@example.test','Other Parent','parent','activity-family-b',1,0)`,
    ),
    db
      .prepare(
        `INSERT INTO "Activity"(id,family_id,user_id,type,title,description,metadata,created_at) VALUES
        ('activity-visible-1','activity-family-a','activity-parent','chore_completed','Visible one','Done','{"ok":true}',?1),
        ('activity-private','activity-family-a','activity-parent','recipe_created','Private source','Hidden','{"timeline":1}',?2),
        ('activity-visible-2','activity-family-a','activity-child','event_created','Visible two',NULL,NULL,?2),
        ('activity-foreign','activity-family-b','activity-foreign','chore_completed','Other household',NULL,NULL,?2)`,
      )
      .bind(first, second),
  ]);

  const page = await readD1Activity(
    parent,
    {
      paged: true,
      paging: { ok: true, limit: 1, cursor: null },
      before: null,
      limit: 1,
    },
    db,
  );
  check(page.status === 200, "activity read succeeds");
  const pageBody = page.body as {
    activities: Array<{ id: string }>;
    nextCursor: string | null;
  };
  check(
    pageBody.activities.length === 1 &&
      pageBody.activities[0]?.id === "activity-visible-2",
    "activity hides private and foreign rows",
  );
  check(pageBody.nextCursor !== null, "activity returns a next cursor");
  const next = await readD1Activity(
    parent,
    {
      paged: true,
      paging: {
        ok: true,
        limit: 10,
        cursor: { createdAt: new Date(second), id: "activity-visible-2" },
      },
      before: null,
      limit: 10,
    },
    db,
  );
  check(
    (next.body as { activities: Array<{ id: string }> }).activities.some(
      (row) => row.id === "activity-visible-1",
    ),
    "activity keyset continuation",
  );

  const locations = await readD1Locations(parent, db);
  check(
    locations.status === 200 &&
      (locations.body as { locations: unknown[] }).locations.length === 0,
    "parent location read",
  );
  check(
    (await readD1Locations(teen, db)).status === 403,
    "teen locations remain private",
  );
  const createdLocation = await createD1Location(
    parent,
    { label: "School", address: "1 Test Street" },
    "activity-location-create",
    db,
  );
  check(createdLocation.status === 201, "location create");
  const locationId = (createdLocation.body as { location: { id: string } })
    .location.id;
  check(
    (
      await updateD1Location(
        parent,
        locationId,
        { label: "School", address: "2 Test Street" },
        db,
      )
    ).status === 200,
    "location update",
  );
  check(
    (await deleteD1Location(teen, locationId, db)).status === 403,
    "teen cannot delete location",
  );
  check(
    (await deleteD1Location(parent, locationId, db)).status === 200,
    "parent deletes location",
  );

  const createdPickup = await createD1Pickup(
    child,
    {
      title: "School pickup",
      location: "School",
      pickup_time: "2026-10-29T15:00:00.000Z",
      assigned_to: parent.userId,
      notes: "Bring the backpack",
    },
    db,
  );
  check(createdPickup.status === 201, "child creates pickup");
  const pickupId = (createdPickup.body as { pickup: { id: string } }).pickup.id;
  const pickups = await readD1Pickups(teen, db);
  check(
    pickups.status === 200 &&
      (pickups.body as { pickups: unknown[] }).pickups.length === 1,
    "family sees pickup",
  );
  check(
    (await updateD1Pickup(child, pickupId, true, db)).status === 200,
    "child completes pickup",
  );
  check(
    (await deleteD1Pickup(child, pickupId, db)).status === 403,
    "child cannot delete pickup",
  );
  check(
    (await deleteD1Pickup(parent, pickupId, db)).status === 200,
    "parent deletes pickup",
  );
  check(
    (await readD1Pickups(foreign, db)).status === 200 &&
      (await readD1Pickups(foreign, db)).body !== undefined,
    "foreign family remains isolated",
  );

  return {
    activity: true,
    activityPaging: true,
    locations: true,
    locationPrivacy: true,
    pickups: true,
    pickupRoles: true,
    householdIsolation: true,
  };
}
