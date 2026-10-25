import { POST as ownedSend } from '../send/route'
// Two-household isolation for /api/messages (#102).

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as messages from "../route";
import { db, req, writesTo, expectNoForeignData } from "@/__tests__/helpers/two-household";

describe("messages — two households", () => {
  beforeEach(() => {
    db.reset();
    // The mutation effect repeats the feature check under its membership
    // locks; keep this harness explicit rather than relying on null-family
    // legacy defaults.
    db.find("family", "family-A")!.features = { messages: true };
    db.find("family", "family-B")!.features = { messages: true };
  });

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await messages.GET(req())).status).toBe(401);
    expect((await messages.POST(req({ body: { content: "hi" } }))).status).toBe(401);
    expect((await messages.PATCH(req({ body: { markAll: true } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family messages and members", async () => {
    const body = await expectNoForeignData(await messages.GET(req({ as: "childA" })));
    expect(body.messages.map((m: any) => m.id)).toEqual(["msg-a"]);
    expect(body.members.map((m: any) => m.id).sort()).toEqual(["child-a", "parent-a", "teen-a"]);
  });

  it("cannot mark another family's message as read", async () => {
    const res = await messages.PATCH(req({ as: "parentA", body: { messageIds: ["msg-b"] } }));
    expect(res.status).toBe(200);
    expect(db.find("message", "msg-b")?.read_by).toEqual([]);
  });

  it("markAll only touches the caller's family", async () => {
    await messages.PATCH(req({ as: "parentA", body: { markAll: true } }));
    expect(db.find("message", "msg-a")?.read_by).toEqual(["parent-a"]);
    expect(db.find("message", "msg-b")?.read_by).toEqual([]);
  });

  it('refuses an explicit read batch above the documented limit before any write', async () => {
    const res = await messages.PATCH(
      req({
        as: 'parentA',
        body: { messageIds: Array.from({ length: 1001 }, (_, index) => `msg-${index}`) },
      }),
    );
    expect(res.status).toBe(400);
    expect(db.writes).toHaveLength(0);
  });

  it('refuses an oversized read body before any write', async () => {
    const res = await messages.PATCH(
      req({
        as: 'parentA',
        body: { messageIds: Array.from({ length: 1000 }, () => 'x'.repeat(300)) },
      }),
    );
    expect(res.status).toBe(413);
    expect(db.writes).toHaveLength(0);
  });

  it("sends into the caller's family", async () => {
    const res = await messages.POST(req({ as: "childA", body: { content: "hi", family_id: "family-B" } }));
    expect(res.status).toBe(200);
    expect(writesTo("message")[0].args.data).toMatchObject({ family_id: "family-A", sender_id: "child-a" });
  });

  it('returns only the safe pickup context for a linked family pickup', async () => {
    const res = await messages.POST(req({ as: 'parentA', body: { content: 'I will be there', pickup_id: 'pickup-a' } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message.pickup).toMatchObject({ id: 'pickup-a', title: 'Home school pickup', completed: false });
    expect(body.message.pickup).toHaveProperty('pickup_time');
    expect(body.message.pickup).not.toHaveProperty('location');
    expect(body.message.pickup).not.toHaveProperty('notes');
  });

  it('does not link a pickup from another family', async () => {
    const res = await messages.POST(req({ as: 'parentA', body: { content: 'foreign context', pickup_id: 'pickup-b' } }));
    expect(res.status).toBe(404);
    expect(writesTo('message')).toHaveLength(0);
  });

  it('replays a keyed send without creating a second message', async () => {
    const first = await messages.POST(req({
      as: 'parentA',
      body: { content: 'same once', pickup_id: 'pickup-a' },
      headers: { 'Idempotency-Key': 'messages-create-20261018-0001' },
    }));
    const second = await messages.POST(req({
      as: 'parentA',
      body: { pickup_id: 'pickup-a', content: 'same once' },
      headers: { 'Idempotency-Key': 'messages-create-20261018-0001' },
    }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers.get('Idempotency-Replayed')).toBe('true');
    expect(writesTo('message').filter((write) => write.op === 'create')).toHaveLength(1);
    expect(await first.json()).toEqual(await second.json());
  });
});

describe('opt-in message keysets (source only)', () => {
  beforeEach(() => db.reset())
  it('continues through tied timestamps after the pivot row is deleted without changing chronological DTOs', async () => {
    const original = db.find('message', 'msg-a')!
    for (const id of ['tie-a', 'tie-b', 'tie-c']) db.rows('message').push({ ...original, id, created_at: new Date('2026-10-25T12:00:00Z') })
    const first = await (await messages.GET(req({ as: 'childA', query: { paging: 'keyset-v1', limit: '2' } }))).json()
    expect(first.messages.map((row: any) => row.id)).toEqual(['tie-b', 'tie-a'])
    expect(first.nextCursor).toBeTruthy()
    expect(first.readContext).toEqual({ userId: 'child-a', familyId: 'family-A' })
    await require('@/__tests__/helpers/two-household').fakePrisma.message.deleteMany({ where: { id: 'tie-b' } })
    const next = await (await messages.GET(req({ as: 'childA', query: { paging: 'keyset-v1', limit: '2', cursor: first.nextCursor } }))).json()
    expect(next.messages.map((row: any) => row.id)).toEqual(['msg-a', 'tie-c'])
    expect(next.nextCursor).toBeNull()
    expect(next.members.map((member: any) => member.id).sort()).toEqual(['child-a', 'parent-a', 'teen-a'])
    expect(next.userId).toBe('child-a')
    expect((await messages.GET(req({ as: 'childB', query: { paging: 'keyset-v1', limit: '2', cursor: first.nextCursor } }))).status).toBe(400)
  })
  it('retains legacy timestamp cursor shape and refuses an unknown paging mode', async () => {
    const legacy = await (await messages.GET(req({ as: 'childA', query: { limit: '1' } }))).json()
    expect(legacy.messages.map((row: any) => row.id)).toEqual(['msg-a'])
    expect(legacy).not.toHaveProperty('nextCursor')
    const before = await (await messages.GET(req({ as: 'childA', query: { cursor: legacy.messages[0].created_at } }))).json()
    expect(before.messages).toEqual([])
    expect((await messages.GET(req({ as: 'childA', query: { paging: 'unknown' } }))).status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })
})

describe('owned message send preconditions (source only)', () => {
  beforeEach(() => { db.reset(); db.find('family', 'family-A')!.features = { messages: true } })
  it('refuses missing/changed household/account/session context before a message or receipt effect', async () => {
    const proof = (await (await messages.GET(req({ as: 'childA', query: { paging: 'keyset-v1' } }))).json()).writeContext
    const body = { issued_at: new Date().toISOString(), content: 'Private original draft', expected_user_id: proof.userId, expected_family_id: proof.familyId, expected_generation: proof.generation }
    expect((await ownedSend(req({ as: 'childA', body: { content: 'Missing context' } }))).status).toBe(400)
    const noKey = await ownedSend(req({ as: 'childA', body }))
    expect(noKey.status).toBe(400)
    expect(await noKey.json()).toMatchObject({ code: 'MESSAGE_KEY_REQUIRED' })
    for (const change of [{ expected_user_id: 'child-b' }, { expected_family_id: 'family-B' }, { expected_generation: proof.generation + 1 }]) {
      const response = await ownedSend(req({ as: 'childA', body: { ...body, ...change } }))
      expect(response.status).toBe(409)
      expect(await response.json()).toMatchObject({ code: 'MESSAGE_OWNER_CHANGED' })
    }
    expect(db.writes).toHaveLength(0)
  })
  it('replays a matching owned send once through the canonical message effect', async () => {
    const proof = (await (await messages.GET(req({ as: 'childA', query: { paging: 'keyset-v1' } }))).json()).writeContext
    const body = { issued_at: new Date().toISOString(), content: 'Owned current message', expected_user_id: proof.userId, expected_family_id: proof.familyId, expected_generation: proof.generation }
    const call = () => ownedSend(req({ as: 'childA', body, headers: { 'Idempotency-Key': 'owned-message-request-00001' } }))
    const first = await call(), replay = await call()
    expect(first.status).toBe(200); expect(replay.status).toBe(200)
    expect((await first.json()).message.id).toBe((await replay.json()).message.id)
    expect(db.rows('message').filter(row => row.content === body.content)).toHaveLength(1)
  })
})

describe('original message send time (source only)', () => {
  beforeEach(() => { db.reset(); db.find('family', 'family-A')!.features = { messages: true } })
  it('refuses missing, expired and far-future original timestamps without receipt/message writes', async () => {
    const proof = (await (await messages.GET(req({ as: 'childA', query: { paging: 'keyset-v1' } }))).json()).writeContext
    const base = { content: 'Held original message', expected_user_id: proof.userId, expected_family_id: proof.familyId, expected_generation: proof.generation }
    for (const issued_at of [undefined, new Date(Date.now() - 2 * 86400000).toISOString(), new Date(Date.now() + 3600000).toISOString()]) {
      const response = await ownedSend(req({ as: 'childA', body: { ...base, issued_at }, headers: { 'Idempotency-Key': 'time-held-message-00001' } }))
      expect(response.status).toBe(issued_at === undefined ? 400 : 409)
      expect(await response.json()).toMatchObject({ code: issued_at === undefined ? 'MESSAGE_SEND_TIME_REQUIRED' : 'MESSAGE_SEND_WINDOW_CLOSED' })
    }
    expect(db.writes).toHaveLength(0)
  })
})
