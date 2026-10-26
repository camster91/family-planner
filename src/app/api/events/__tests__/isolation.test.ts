import { CALENDAR_OWNER_HEADER } from "@/lib/calendar-read-owner";
import { calendarReadOwnerFixture } from "@/__tests__/helpers/calendar-read-owner";
// Two-household isolation for /api/events (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as events from "../route";
import { db, req, fakePrisma, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

const newEvent = { title: "Swim", start_time: "2026-10-01T10:00:00.000Z", event_type: "sports" };

describe("events — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await events.GET(req())).status).toBe(401);
    expect((await events.POST(req({ body: newEvent }))).status).toBe(401);
    expect((await events.PATCH(req({ body: { eventId: "event-a", title: "x" } }))).status).toBe(401);
    expect((await events.DELETE(req({ body: { eventId: "event-a" } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family and hides a foreign event by id", async () => {
    const list = await expectNoForeignData(await events.GET(req({ as: "childA" })));
    expect(list.events.map((e: any) => e.id)).toEqual(["event-a"]);
    await expectDenied(await events.GET(req({ as: "parentA", query: { id: "event-b" } })));
  });

  it("refuses to update or delete another family's event", async () => {
    await expectDenied(await events.PATCH(req({ as: "parentA", body: { eventId: "event-b", title: "x" } })));
    await expectDenied(await events.DELETE(req({ as: "parentA", body: { eventId: "event-b" } })));
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot edit or delete events", async (who) => {
    expect((await events.PATCH(req({ as: who, body: { eventId: "event-a", title: "x" } }))).status).toBe(403);
    expect((await events.DELETE(req({ as: who, body: { eventId: "event-a" } }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("creates in the caller's family and lets a parent edit it", async () => {
    const res = await events.POST(req({ as: "childA", body: { ...newEvent, family_id: "family-B" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(writesTo("event")[0].args.data).toMatchObject({ family_id: "family-A", created_by: "child-a" });
    expect((await events.PATCH(req({ as: "parentA", body: { eventId: "event-a", title: "Moved" } }))).status).toBe(200);
    expect((await events.DELETE(req({ as: "parentA", body: { eventId: "event-a" } }))).status).toBe(200);
  });
});

// Authored UNRUN: foreign existence and malformed targets do not become list reads.
it('uses the same not-found result for an absent or another household event', async () => {
  db.reset();
  const absent = await events.GET(req({as:'parentA',query:{id:'missing-event'}}));
  const foreign = await events.GET(req({as:'parentA',query:{id:'event-b'}}));
  expect(absent.status).toBe(404);
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toEqual(await absent.json());
  expect(writesTo('event')).toHaveLength(0);
});
it.each(['/api/events?id=','/api/events?id=event-a&id=event-b'])('refuses malformed exact-event selection (%s)', async path => {
  db.reset();
  const response = await events.GET(req({as:'parentA',path}));
  expect(response.status).toBe(400);
  const body = await response.json();
  expect(body).not.toHaveProperty('events');
  expect(body).not.toHaveProperty('event');
  expect(writesTo('event')).toHaveLength(0);
});


// Authored UNRUN: relationship labels are scoped independently of scalar history.
it.each(['single','range','legacy'] as const)('omits a moved creator name from %s event reads', async mode => {
  db.reset();
  Object.assign(db.find('event','event-a')!, {created_by:'child-b',start_time:new Date('2099-01-04T12:00:00.000Z'),end_time:new Date('2099-01-04T13:00:00.000Z')});
  const query: Record<string,string> = mode === 'single' ? {id:'event-a'} : mode === 'range'
    ? {start:'2099-01-01T00:00:00.000Z',end:'2099-01-08T00:00:00.000Z',limit:'20'} : {};
  const response = await events.GET(req({as:'parentA',query}));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.json();
  const result = body.event ?? body.events[0];
  expect(result.id).toBe('event-a');
  expect(result.created_by).toBe('child-b');
  expect(result.creator).toBeNull();
  expect(JSON.stringify(body)).not.toContain('FOREIGN');
});
it('withholds already-loaded event data if the viewer changes households during creator lookup', async () => {
  db.reset();
  const originalFindMany = fakePrisma.user.findMany;
  const lookup = jest.spyOn(fakePrisma.user,'findMany').mockImplementationOnce(async (...args: unknown[]) => {
    const people = await originalFindMany(...args);
    db.find('user','parent-a')!.family_id = 'family-B';
    return people;
  });
  try {
    const response = await events.GET(req({as:'parentA',query:{id:'event-a'}}));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('EVENT_SCOPE_CHANGED');
    expect(body).not.toHaveProperty('event');
    expect(body).not.toHaveProperty('events');
  } finally { lookup.mockRestore(); }
});

// Authored UNRUN: optional comparison headers preserve old clients, never grant access.
it('echoes the renewed owner without changing legacy response bodies', async () => {
  db.reset();
  const response = await events.GET(req({as:'parentA',query:{id:'event-a'}}));
  expect(response.status).toBe(200);
  expect(JSON.parse(response.headers.get(CALENDAR_OWNER_HEADER)!)).toEqual(calendarReadOwnerFixture);
  expect(await response.json()).toHaveProperty('event.id','event-a');
});
it.each(['{}','bad-json',JSON.stringify({...calendarReadOwnerFixture,familyId:'family-B'}),
  JSON.stringify({...calendarReadOwnerFixture,generation:1})])('refuses an invalid or different original owner (%s)', async marker => {
  db.reset();
  const response = await events.GET(req({as:'parentA',headers:{[CALENDAR_OWNER_HEADER]:marker},query:{id:'event-a'}}));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({error:'Your account or household changed. Reload the calendar.',code:'EVENT_SCOPE_CHANGED'});
  expect(response.headers.get(CALENDAR_OWNER_HEADER)).toBeNull();
  expect(writesTo('event')).toHaveLength(0);
});
