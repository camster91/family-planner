import type { D1Store } from "../../../src/lib/cloudflare/database";
import {
  commitD1ImportedEvents,
  undoD1ImportedEvents,
} from "../../../src/lib/cloudflare/calendar-import";
import { commitSchema } from "../../../src/lib/event-import-commit";

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const familyId = "calendar-import-family";
const parent = {
  userId: "calendar-import-parent",
  familyId,
  role: "parent",
  generation: 0,
  name: "Calendar Parent",
} as const;
const child = {
  userId: "calendar-import-child",
  familyId,
  role: "child",
  generation: 0,
  name: "Calendar Child",
} as const;

/** Native reviewed calendar import commit, replay and scoped undo coverage. */
export async function testCalendarImport(db: D1Store) {
  await db.batch([
    db
      .prepare(
        `INSERT INTO "Family"(id,name,invite_code,features) VALUES
          (?1,'Calendar import','calendar-import-code','{"calendar":true}')`,
      )
      .bind(familyId),
    db.prepare(
      `INSERT INTO "User"(id,email,name,role,family_id,email_verified,token_version) VALUES
        ('calendar-import-parent','calendar-import-parent@example.test','Calendar Parent','parent',?1,1,0),
        ('calendar-import-child','calendar-import-child@example.test','Calendar Child','child',?1,1,0)`,
    ).bind(familyId),
  ]);
  const now = new Date("2026-10-28T16:00:00.000Z");
  const input = commitSchema.parse({
    events: [
      {
        title: "Imported school pickup",
        description: "Fixture event",
        start_time: "2026-10-29T15:00:00.000Z",
        end_time: "2026-10-29T16:00:00.000Z",
        location: "School",
      },
      {
        title: "Imported dinner",
        start_time: "2026-10-30T18:00:00.000Z",
      },
    ],
  });
  const first = await commitD1ImportedEvents(
    parent,
    input,
    "calendar-import-key",
    db,
    now,
  );
  check(first.status === 201 && first.replayed === false, "calendar import commit");
  const body = first.body as { eventIds: string[]; undoToken: string; count: number };
  check(body.count === 2 && body.eventIds.length === 2 && body.undoToken, "calendar import receipt");
  check(
    (await db.prepare(`SELECT count(*) AS count FROM "Event" WHERE family_id=?1`).bind(familyId).first<{ count: number }>())?.count === 2,
    "calendar import creates events",
  );
  check(
    (await db.prepare(`SELECT count(*) AS count FROM "Activity" WHERE family_id=?1 AND type='events_imported'`).bind(familyId).first<{ count: number }>())?.count === 1,
    "calendar import activity provenance",
  );

  const replay = await commitD1ImportedEvents(parent, input, "calendar-import-key", db, now);
  check(replay.status === 201 && replay.replayed === true, "calendar import replay");
  check(
    (await db.prepare(`SELECT count(*) AS count FROM "Event" WHERE family_id=?1`).bind(familyId).first<{ count: number }>())?.count === 2,
    "calendar import replay creates nothing",
  );
  check(
    (await commitD1ImportedEvents(child, input, "calendar-child-key", db, now)).status === 403,
    "calendar import child refusal",
  );

  const undone = await undoD1ImportedEvents(parent, body.undoToken, db, now.getTime() + 60_000);
  check(undone.status === 200 && (undone.body as any).removedCount === 2, "calendar import undo");
  const repeated = await undoD1ImportedEvents(parent, body.undoToken, db, now.getTime() + 61_000);
  check(repeated.status === 200 && (repeated.body as any).removedCount === 0, "calendar import undo replay");
  check(
    (await db.prepare(`SELECT count(*) AS count FROM "Event" WHERE family_id=?1`).bind(familyId).first<{ count: number }>())?.count === 0,
    "calendar import undo removes only owned events",
  );
  return { commit: true, provenance: true, replay: true, roleBoundary: true, undo: true, undoReplay: true };
}
