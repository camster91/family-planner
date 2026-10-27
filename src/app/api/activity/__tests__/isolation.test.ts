// Two-household isolation for GET /api/activity (#102).

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("@/lib/feature-gate-server", () => ({
  featureGate: async () => null,
}));

import { GET } from "../route";
import {
  db,
  req,
  expectNoForeignData,
  FAMILY_A,
} from "@/__tests__/helpers/two-household";

describe("activity — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 without a session", async () => {
    expect((await GET(req())).status).toBe(401);
  });

  it("returns 400 for a user with no family instead of reading anything", async () => {
    expect((await GET(req({ as: "loner" }))).status).toBe(400);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await GET(req({ as: "childA" })));
    expect(body.activities.map((a: any) => a.id)).toEqual(["act-a"]);
  });

  it("keeps real event_* and events_* rows and hides legacy analytics rows", async () => {
    const base = {
      family_id: FAMILY_A,
      user_id: "parent-a",
      description: null,
      metadata: null,
    };
    db.rows("activity").push(
      {
        ...base,
        id: "act-created",
        type: "event_created",
        title: "Event",
        created_at: new Date("2026-01-02T00:00:00Z"),
      },
      {
        ...base,
        id: "act-imported",
        type: "events_imported",
        title: "Import",
        created_at: new Date("2026-01-03T00:00:00Z"),
      },
      {
        ...base,
        id: "act-pageview",
        type: "event_page_view",
        title: "page",
        created_at: new Date("2026-01-04T00:00:00Z"),
      },
    );
    const res = await GET(req({ as: "parentA" }));
    const ids = (await res.json()).activities.map((a: any) => a.id);
    expect(ids).toEqual(
      expect.arrayContaining(["act-created", "act-imported", "act-a"]),
    );
    expect(ids).not.toContain("act-pageview");
  });
});

it("does not add parent-only timeline facts or their actor/target markers to the legacy member feed", async () => {
  db.reset();
  const base = {
    family_id: FAMILY_A,
    user_id: "parent-a",
    description: null,
    created_at: new Date(),
  };
  db.rows("activity").push(
    {
      ...base,
      id: "private-coordination-fact",
      type: "responsibility_changed",
      title: "Household record changed",
      metadata: JSON.stringify({
        timeline: 1,
        target: { kind: "handoff", id: "private-handoff" },
      }),
    },
    {
      ...base,
      id: "marked-done-fact",
      type: "chore_completed",
      title: "Completed a chore",
      metadata: JSON.stringify({
        timeline: 1,
        actorKind: "device",
        target: { kind: "chore", id: "fixture-chore" },
      }),
    },
  );
  const response = await GET(req({ as: "childA" }));
  const body = await response.json();
  expect(
    body.activities.some(
      (row: { id: string }) => row.id === "private-coordination-fact",
    ),
  ).toBe(false);
  expect(
    body.activities.find((row: { id: string }) => row.id === "marked-done-fact")
      .metadata,
  ).toBeNull();
  expect(JSON.stringify(body)).not.toContain("private-handoff");
});

// Authored only: opt-in paging retains the legacy member DTO/privacy policy.
describe("activity opt-in stable continuation", () => {
  beforeEach(() => {
    db.reset();
    db.rows("activity").splice(0);
    for (const id of ["a", "b", "c", "d", "e"]) db.rows("activity").push({
      id: `tie-${id}`, family_id: FAMILY_A, user_id: "parent-a", type: "event_created",
      title: "Fixture activity", description: null, metadata: null,
      created_at: new Date("2026-10-25T12:00:00.000Z"),
    });
    db.rows("activity").push({ id: "foreign-tie", family_id: "family-B", user_id: "parent-b",
      type: "event_created", title: "Foreign fixture", description: null, metadata: null,
      created_at: new Date("2026-10-25T12:00:00.000Z") });
  });
  it("returns every tied row once through explicit pages and no foreign row", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 4; page++) {
      const response = await GET(req({ as: "childA", query: { paging: "keyset-v1", limit: "2", ...(cursor ? { cursor } : {}) } }));
      expect(response.status).toBe(200);
      const body = await expectNoForeignData(response);
      ids.push(...body.activities.map((row: { id: string }) => row.id));
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    expect(ids).toEqual(["tie-a", "tie-b", "tie-c", "tie-d", "tie-e"]);
    expect(new Set(ids).size).toBe(ids.length); expect(cursor).toBeNull();
  });
  it("continues after the pivot row is removed and refuses another household's cursor", async () => {
    const first = await (await GET(req({ as: "parentA", query: { paging: "keyset-v1", limit: "2" } }))).json();
    db.rows("activity").splice(db.rows("activity").findIndex(row => row.id === "tie-b"), 1);
    const second = await (await GET(req({ as: "parentA", query: { paging: "keyset-v1", limit: "2", cursor: first.nextCursor } }))).json();
    expect(second.activities.map((row: { id: string }) => row.id)).toEqual(["tie-c", "tie-d"]);
    expect((await GET(req({ as: "parentB", query: { paging: "keyset-v1", cursor: first.nextCursor } }))).status).toBe(400);
  });
  it("keeps legacy timestamp cursors, clamping and response shape", async () => {
    const first = await (await GET(req({ as: "parentA", query: { limit: "0" } }))).json();
    expect(first.activities).toHaveLength(1); expect(first.nextCursor).toBeUndefined();
    const older = await (await GET(req({ as: "parentA", query: { cursor: "2026-10-25T12:00:00.000Z" } }))).json();
    expect(older.activities).toEqual([]); expect(older.nextCursor).toBeUndefined();
  });
});
