/**
 * Route-level real-Postgres proof for keyed event capture (#472).
 *
 * This deliberately calls the actual POST handler with the real Prisma client,
 * while using the same session-token lookup seam as the other disposable
 * Postgres route suites. It is opt-in only:
 * RUN_DB_INTEGRATION=1, FIXTURES_ALLOW=1 and a guarded disposable DATABASE_URL.
 *
 * The older #472 wording called a changed-payload conflict 409. The canonical
 * idempotency contract is 422 IDEMPOTENCY_KEY_REUSED; 409 remains reserved for
 * an actually in-progress receipt, so these assertions preserve that contract.
 */

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/session", () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith("session:")) return null;
    const { prisma } = require("@/lib/prisma");
    const user = await prisma.user.findUnique({
      where: { id: token.slice("session:".length) },
    });
    return user
      ? {
          userId: user.id,
          email: user.email,
          role: user.role,
          family_id: user.family_id,
          tv: user.token_version,
        }
      : null;
  },
  getTokenVersion: async () => 0,
}));

import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("events POST capture against Postgres", () => {
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../route").POST;
  let idem: typeof import("@/lib/idempotency");

  const FAMILY = "evt-route-int-family";
  const OTHER_FAMILY = "evt-route-int-other-family";
  const PARENT = "evt-route-int-parent";
  const OTHER_PARENT = "evt-route-int-other-parent";
  const priorSharedDeviceEnabled = process.env.SHARED_DEVICE_ENABLED;
  let sequence = 0;

  const key = (label: string) =>
    `evt-route-${label}-${Date.now().toString(36)}-${(sequence++).toString(36)}`;
  const eventBody = (title: string) => ({
    title,
    start_time: "2026-11-01T06:30:00.000Z",
    end_time: "2026-11-01T07:00:00.000Z",
    event_type: "other" as const,
  });

  function request(
    userId: string,
    body: unknown,
    idempotencyKey?: string,
  ): any {
    const headers = new Headers();
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    const url = new URL("http://localhost/api/events");
    return {
      url: url.toString(),
      nextUrl: url,
      headers,
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: `session:${userId}` } : undefined,
      },
      json: async () => body,
    };
  }

  async function cleanup(): Promise<void> {
    if (!db) return;
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.activity.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.event.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.family.deleteMany({
      where: { id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.deleteMany({
      where: { id: { in: [PARENT, OTHER_PARENT] } },
    });
  }

  beforeAll(async () => {
    // Refuse non-disposable targets before importing the Prisma singleton or
    // opening a database connection. This suite is never a production probe.
    assertFixtureTargetAllowed(process.env);
    process.env.SHARED_DEVICE_ENABLED = "1";

    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    db = mod.prisma;
    POST = (await import("../route")).POST;
    idem = await import("@/lib/idempotency");

    await cleanup();
    await db.family.createMany({
      data: [
        {
          id: FAMILY,
          name: "Event route integration household",
          invite_code: "evt-route-int-family-invite",
        },
        {
          id: OTHER_FAMILY,
          name: "Other event route household",
          invite_code: "evt-route-int-other-invite",
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: PARENT,
          email: "evt-route-int-parent@example.test",
          name: "Event route parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: OTHER_PARENT,
          email: "evt-route-int-other@example.test",
          name: "Other event route parent",
          role: "parent",
          family_id: OTHER_FAMILY,
        },
      ],
    });
    // Avoid nondeterministic housekeeping deleting a concurrent receipt while
    // this suite is proving the route's own idempotency behavior.
    idem.idempotencyRuntime.random = () => 0.99;
  });

  beforeEach(async () => {
    await db.idempotencyRecord.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.activity.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.event.deleteMany({
      where: { family_id: { in: [FAMILY, OTHER_FAMILY] } },
    });
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: FAMILY },
    });
  });

  afterEach(async () => {
    // A failed assertion must not leave the next test with a moved account.
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: FAMILY },
    });
  });

  afterAll(async () => {
    if (!db) return;
    idem.idempotencyRuntime.random = () => Math.random();
    try {
      await db.user.updateMany({
        where: { id: PARENT },
        data: { family_id: FAMILY },
      });
      await cleanup();
    } finally {
      if (priorSharedDeviceEnabled === undefined) {
        delete process.env.SHARED_DEVICE_ENABLED;
      } else {
        process.env.SHARED_DEVICE_ENABLED = priorSharedDeviceEnabled;
      }
      await db.$disconnect();
    }
  });

  it("converges concurrent same-key POSTs to one event and one activity", async () => {
    const body = eventBody("Concurrent route event");
    const requestKey = key("concurrent");
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => POST(request(PARENT, body, requestKey))),
    );

    expect(
      responses.every(
        (response) => response.status === 200 || response.status === 409,
      ),
    ).toBe(true);
    expect(
      responses.filter(
        (response) =>
          response.status === 200 &&
          response.headers.get("Idempotency-Replayed") === null,
      ),
    ).toHaveLength(1);

    expect(await db.event.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(await db.activity.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(
      await db.idempotencyRecord.count({
        where: { family_id: FAMILY, scope: `user:${PARENT}`, key: requestKey },
      }),
    ).toBe(1);

    const replay = await POST(request(PARENT, body, requestKey));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    const replayBody = await replay.json();
    const saved = await db.event.findFirstOrThrow({
      where: { family_id: FAMILY, title: body.title },
    });
    expect(replayBody.event.id).toBe(saved.id);
  });

  it("replays a lost response and rejects a changed payload with 422", async () => {
    const requestKey = key("replay");
    const body = eventBody("Lost response event");

    // The caller intentionally discards the first response, modelling a
    // connection lost after the route committed its transaction.
    const first = await POST(request(PARENT, body, requestKey));
    expect(first.status).toBe(200);

    const replay = await POST(request(PARENT, body, requestKey));
    expect(replay.status).toBe(200);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");

    const changed = await POST(
      request(PARENT, eventBody("Changed payload"), requestKey),
    );
    expect(changed.status).toBe(422);
    expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.event.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(
      await db.event.findFirstOrThrow({ where: { family_id: FAMILY } }),
    ).toMatchObject({ title: body.title, created_by: PARENT });
  });

  it("scopes the same key per user and rejects reuse after a household move", async () => {
    const requestKey = key("scope");
    const body = eventBody("Scoped route event");

    const own = await POST(request(PARENT, body, requestKey));
    const other = await POST(request(OTHER_PARENT, body, requestKey));
    expect(own.status).toBe(200);
    expect(other.status).toBe(200);
    expect(own.headers.get("Idempotency-Replayed")).toBeNull();
    expect(other.headers.get("Idempotency-Replayed")).toBeNull();

    expect(await db.event.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(await db.event.count({ where: { family_id: OTHER_FAMILY } })).toBe(
      1,
    );
    expect(
      await db.event.findFirstOrThrow({ where: { family_id: FAMILY } }),
    ).toMatchObject({ created_by: PARENT, title: body.title });
    expect(
      await db.event.findFirstOrThrow({ where: { family_id: OTHER_FAMILY } }),
    ).toMatchObject({ created_by: OTHER_PARENT, title: body.title });

    // A valid session whose current household changed cannot reuse the old
    // receipt. The idempotency helper returns the canonical 422 conflict and
    // the event route never executes its effect in the new household.
    await db.user.update({
      where: { id: PARENT },
      data: { family_id: OTHER_FAMILY },
    });
    const moved = await POST(request(PARENT, body, requestKey));
    expect(moved.status).toBe(422);
    expect((await moved.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await db.event.count({ where: { family_id: FAMILY } })).toBe(1);
    expect(await db.event.count({ where: { family_id: OTHER_FAMILY } })).toBe(
      1,
    );
  });
});
