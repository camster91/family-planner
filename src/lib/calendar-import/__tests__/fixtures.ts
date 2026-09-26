// Test-only seed for calendar subscriptions on top of the two-household fake
// (src/__tests__/helpers/two-household.ts). Not a test file.

import {
  db,
  fakePrisma,
  FAMILY_A,
  FAMILY_B,
  FOREIGN,
} from "@/__tests__/helpers/two-household";
import { encryptSecret } from "@/lib/secret-box";

export const SECRET_URL_A =
  "https://cal.example.com/calendar/private-SECRETA/basic.ics";
export const SECRET_URL_B =
  "https://cal.example.com/calendar/private-SECRETB/basic.ics";

const T0 = new Date("2026-09-01T00:00:00Z");

/** Add one subscription per family, plus one imported event for family B. */
export function seedSubscriptions() {
  db.rows("calendarSubscription").push(
    {
      id: "sub-a",
      family_id: FAMILY_A,
      name: "School",
      url_enc: encryptSecret(SECRET_URL_A),
      color: "#2563eb",
      last_fetched_at: null,
      last_status: "pending",
      last_error: null,
      etag: null,
      last_modified: null,
      created_by: "parent-a",
      created_at: T0,
      updated_at: T0,
    },
    {
      id: "sub-b",
      family_id: FAMILY_B,
      name: `${FOREIGN} league`,
      url_enc: encryptSecret(SECRET_URL_B),
      color: null,
      last_fetched_at: null,
      last_status: "pending",
      last_error: null,
      etag: null,
      last_modified: null,
      created_by: "parent-b",
      created_at: T0,
      updated_at: T0,
    },
  );
  db.rows("event").push({
    id: "event-imported-b",
    family_id: FAMILY_B,
    title: `${FOREIGN} game`,
    description: null,
    start_time: new Date(Date.now() + 86400000),
    end_time: new Date(Date.now() + 90000000),
    location: null,
    event_type: "other",
    recurrence: null,
    created_by: "parent-b",
    project_id: null,
    is_task: false,
    created_at: T0,
    source_subscription_id: "sub-b",
    source_uid: "game-1",
    source_occurrence_start: new Date(Date.now() + 86400000),
  });
}

/** Add an imported event for family A (sub-a). */
export function seedImportedEventA(id = "event-imported-a") {
  const start = new Date(Date.now() + 2 * 86400000);
  db.rows("event").push({
    id,
    family_id: FAMILY_A,
    title: "Imported assembly",
    description: null,
    start_time: start,
    end_time: new Date(start.getTime() + 3600000),
    location: null,
    event_type: "other",
    recurrence: null,
    created_by: "parent-a",
    project_id: null,
    is_task: false,
    created_at: T0,
    source_subscription_id: "sub-a",
    source_uid: "assembly-1",
    source_occurrence_start: start,
  });
}

/** The fake has no createMany; add one honouring the (subscription, uid, occurrence) unique index. */
export function installCreateMany() {
  const events = fakePrisma.event;
  events.createMany = async ({
    data,
    skipDuplicates,
  }: {
    data: any[];
    skipDuplicates?: boolean;
  }) => {
    let count = 0;
    for (const row of data) {
      const dup = db
        .rows("event")
        .some(
          (r) =>
            r.source_subscription_id != null &&
            r.source_subscription_id === row.source_subscription_id &&
            r.source_uid === row.source_uid &&
            new Date(r.source_occurrence_start).getTime() ===
              new Date(row.source_occurrence_start).getTime(),
        );
      if (dup) {
        if (skipDuplicates) continue;
        throw Object.assign(new Error("Unique constraint failed"), {
          code: "P2002",
        });
      }
      await events.create({ data: row });
      count++;
    }
    return { count };
  };
}

export function ics(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

export function icsResponse(
  body: string,
  headers: Record<string, string> = {},
) {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/calendar", ...headers },
  });
}
