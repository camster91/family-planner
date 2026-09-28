// Real-Postgres check of two-way calendar sync (#264): unique keys, the
// ON DELETE SET NULL tombstone, @updatedAt for last-writer-wins, cascades and
// household isolation. The provider is the in-memory fake; no network.
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...

import { encryptToken, tokenAad } from "../token-crypto";
import {
  clearSyncEnv,
  FakeOAuth,
  FakeProvider,
  setSyncEnv,
  TEST_CONFIG,
} from "./fakes";

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeWithDatabase("calendar sync persistence (Postgres)", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  const familyId = "calsync-family";
  const otherFamilyId = "calsync-family-2";
  const parentId = "calsync-parent";
  const otherParentId = "calsync-parent-2";
  const HOUR = 3600000;
  const inDays = (d: number) => new Date(Date.now() + d * 86400000);

  let provider: FakeProvider;
  let deps: any;

  beforeAll(async () => {
    setSyncEnv();
    const prismaModule = await import("@/lib/prisma");
    if (!prismaModule.prisma) throw new Error("Integration database is not configured");
    prisma = prismaModule.prisma;
    await prisma.family.deleteMany({ where: { id: { in: [familyId, otherFamilyId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [parentId, otherParentId] } } });
    await prisma.family.createMany({
      data: [
        { id: familyId, name: "Cal Sync", invite_code: "calsync-invite" },
        { id: otherFamilyId, name: "Cal Sync 2", invite_code: "calsync-invite-2" },
      ],
    });
    await prisma.user.createMany({
      data: [
        { id: parentId, email: "p@calsync.test", name: "P", role: "parent", family_id: familyId },
        { id: otherParentId, email: "p2@calsync.test", name: "P2", role: "parent", family_id: otherFamilyId },
      ],
    });
  });

  afterAll(async () => {
    await prisma.family.deleteMany({ where: { id: { in: [familyId, otherFamilyId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [parentId, otherParentId] } } });
    await prisma.$disconnect();
    clearSyncEnv();
  });

  beforeEach(async () => {
    await prisma.event.deleteMany({ where: { family_id: { in: [familyId, otherFamilyId] } } });
    await prisma.calendarConnection.deleteMany({ where: { family_id: { in: [familyId, otherFamilyId] } } });
    provider = new FakeProvider();
    deps = {
      db: prisma,
      adapterFor: () => provider,
      oauthFor: () => new FakeOAuth(),
      configFor: () => TEST_CONFIG,
    };
  });

  async function connect(fid = familyId, uid = parentId, pushMode = "linked") {
    return prisma.calendarConnection.create({
      data: {
        family_id: fid,
        user_id: uid,
        provider: "google",
        calendar_id: "primary",
        calendar_name: "Home",
        access_token_enc: encryptToken("ACCESS", tokenAad.access(fid)),
        refresh_token_enc: encryptToken("REFRESH", tokenAad.refresh(fid)),
        token_expires_at: new Date(Date.now() + HOUR),
        push_mode: pushMode,
      },
    });
  }

  it("imports idempotently and the unique keys block duplicate links", async () => {
    const { syncConnection } = await import("../sync");
    const conn = await connect();
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    provider.remoteUpsert("r2", { title: "Piano", start: inDays(3) });

    expect(await syncConnection(conn.id, familyId, deps)).toMatchObject({ status: "ok", pulled: { created: 2 } });
    await syncConnection(conn.id, familyId, deps);
    await prisma.calendarConnection.update({ where: { id: conn.id }, data: { sync_cursor: null } });
    await syncConnection(conn.id, familyId, deps);
    expect(await prisma.event.count({ where: { source_connection_id: conn.id } })).toBe(2);
    expect(await prisma.calendarEventLink.count({ where: { connection_id: conn.id } })).toBe(2);

    const link = await prisma.calendarEventLink.findFirstOrThrow({ where: { connection_id: conn.id } });
    await expect(
      prisma.calendarEventLink.create({
        data: { family_id: familyId, connection_id: conn.id, external_id: link.external_id },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.calendarEventLink.create({
        data: { family_id: familyId, connection_id: conn.id, event_id: link.event_id, external_id: "other" },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    // NULL event_id tombstones do not collide with each other.
    await prisma.calendarEventLink.createMany({
      data: [
        { family_id: familyId, connection_id: conn.id, event_id: null, external_id: "t1" },
        { family_id: familyId, connection_id: conn.id, event_id: null, external_id: "t2" },
      ],
    });
  });

  it("a local delete becomes a tombstone (FK SET NULL) and is pushed; local edits push with @updatedAt", async () => {
    const { syncConnection } = await import("../sync");
    const conn = await connect();
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) }, new Date(Date.now() - HOUR));
    provider.remoteUpsert("r2", { title: "Piano", start: inDays(3) }, new Date(Date.now() - HOUR));
    await syncConnection(conn.id, familyId, deps);

    const swim = await prisma.event.findFirstOrThrow({ where: { title: "Swim", family_id: familyId } });
    const edited = await prisma.event.update({ where: { id: swim.id }, data: { title: "Swim lessons" } });
    expect(edited.updated_at.getTime()).toBeGreaterThan(swim.updated_at.getTime() - 1);

    const piano = await prisma.event.findFirstOrThrow({ where: { title: "Piano", family_id: familyId } });
    await prisma.event.delete({ where: { id: piano.id } });
    const tomb = await prisma.calendarEventLink.findFirstOrThrow({ where: { connection_id: conn.id, external_id: "r2" } });
    expect(tomb.event_id).toBeNull();

    const res = await syncConnection(conn.id, familyId, deps);
    expect(res).toMatchObject({ status: "ok", pushed: { updated: 1, deleted: 1 } });
    expect(provider.items.get("r1")!.ev.title).toBe("Swim lessons");
    expect(provider.items.get("r2")!.ev.deleted).toBe(true);
    expect(await prisma.calendarEventLink.count({ where: { connection_id: conn.id } })).toBe(1);

    // Remote edit newer than the local row wins.
    provider.remoteUpsert("r1", { title: "Swim (remote)" }, new Date(Date.now() + 60000));
    await prisma.event.update({ where: { id: swim.id }, data: { title: "Swim (local)" } });
    const res2 = await syncConnection(conn.id, familyId, deps);
    expect(res2).toMatchObject({ conflicts: 1 });
    expect((await prisma.event.findUniqueOrThrow({ where: { id: swim.id } })).title).toBe("Swim (remote)");
    expect((await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } })).conflicts_count).toBe(1);
  });

  it("push_mode all pushes native events once and never other households' events", async () => {
    const { syncConnection } = await import("../sync");
    const conn = await connect(familyId, parentId, "all");
    await prisma.event.create({
      data: { family_id: familyId, title: "Dentist", start_time: inDays(4), end_time: new Date(inDays(4).getTime() + HOUR), created_by: parentId },
    });
    await prisma.event.create({
      data: { family_id: otherFamilyId, title: "FOREIGN game", start_time: inDays(4), end_time: inDays(4), created_by: otherParentId },
    });
    await syncConnection(conn.id, familyId, deps);
    await syncConnection(conn.id, familyId, deps);
    expect(provider.live().map((e) => e.title)).toEqual(["Dentist"]);
    expect(await prisma.event.count({ where: { family_id: familyId } })).toBe(1);
  });

  it("disconnect removes imported events and links; family deletion cascades everything", async () => {
    const { syncConnection, removeConnection } = await import("../sync");
    const conn = await connect();
    const other = await connect(otherFamilyId, otherParentId);
    provider.remoteUpsert("r1", { title: "Swim", start: inDays(2) });
    await syncConnection(conn.id, familyId, deps);
    await syncConnection(other.id, otherFamilyId, deps);

    expect(await removeConnection(other.id, familyId, deps)).toBeNull();
    expect(await removeConnection(conn.id, familyId, deps)).toEqual({ removedEvents: 1 });
    expect(await prisma.calendarEventLink.count({ where: { connection_id: conn.id } })).toBe(0);
    expect(await prisma.event.count({ where: { family_id: otherFamilyId } })).toBe(1);

    await prisma.calendarOAuthState.create({
      data: {
        state_hash: "h-calsync", family_id: otherFamilyId, user_id: otherParentId, provider: "google",
        code_verifier_enc: "x", expires_at: new Date(Date.now() + 60000),
      },
    });
    await prisma.family.delete({ where: { id: otherFamilyId } });
    expect(await prisma.calendarConnection.count({ where: { family_id: otherFamilyId } })).toBe(0);
    expect(await prisma.calendarEventLink.count({ where: { family_id: otherFamilyId } })).toBe(0);
    expect(await prisma.calendarOAuthState.count({ where: { family_id: otherFamilyId } })).toBe(0);
    await prisma.family.create({ data: { id: otherFamilyId, name: "Cal Sync 2", invite_code: "calsync-invite-2" } });
    await prisma.user.update({ where: { id: otherParentId }, data: { family_id: otherFamilyId } });
  });

  it("concurrent callback commits cannot exceed the household limit", async () => {
    const { commitConnection } = await import("../connections");
    const extra = Array.from({ length: 7 }, (_, i) => `calsync-extra-${i}`);
    await prisma.user.deleteMany({ where: { id: { in: extra } } });
    await prisma.user.createMany({
      data: extra.map((id) => ({ id, email: `${id}@calsync.test`, name: id, role: "parent", family_id: familyId })),
    });
    try {
      for (const id of extra.slice(0, 5)) await connect(familyId, id);
      const data = { access_token_enc: "x", refresh_token_enc: "y", status: "pending" };
      const outcomes = await Promise.all(
        extra.slice(5).map((userId) =>
          commitConnection(prisma, { familyId, userId, provider: "google", data, hasRefreshToken: true }),
        ),
      );
      expect(outcomes.sort()).toEqual(["created", "limit"]);
      expect(await prisma.calendarConnection.count({ where: { family_id: familyId } })).toBe(6);
      // Re-connecting an existing member is still allowed at the limit.
      expect(
        await commitConnection(prisma, { familyId, userId: extra[0], provider: "google", data, hasRefreshToken: true }),
      ).toBe("updated");
    } finally {
      await prisma.calendarConnection.deleteMany({ where: { family_id: familyId } });
      await prisma.user.deleteMany({ where: { id: { in: extra } } });
    }
  });

  it("a calendar change during a sync blocks the stale run's inserts and cursor", async () => {
    const { syncConnection, changeCalendar } = await import("../sync");
    const conn = await connect();
    provider.remoteUpsert("r1", { title: "Old calendar", start: inDays(2) });
    const realPull = provider.pull.bind(provider);
    provider.pull = async (...args: Parameters<FakeProvider["pull"]>) => {
      const res = await realPull(...args);
      await changeCalendar(prisma, conn.id, familyId, { id: "work", name: "Work" });
      return res;
    };
    expect(await syncConnection(conn.id, familyId, deps)).toMatchObject({ status: "superseded" });
    const after = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after).toMatchObject({ calendar_id: "work", sync_cursor: null, generation: 1, status: "pending" });
    expect(await prisma.event.count({ where: { source_connection_id: conn.id } })).toBe(0);
    expect(await prisma.calendarEventLink.count({ where: { connection_id: conn.id } })).toBe(0);
  });

  it("OAuth state is single use under concurrency", async () => {
    const { createOAuthState, consumeOAuthState } = await import("../oauth");
    const { state } = await createOAuthState(prisma, { familyId, userId: parentId, provider: "google" });
    const results = await Promise.all(
      [0, 1, 2, 3].map(() => consumeOAuthState(prisma, { state, familyId, userId: parentId, provider: "google" })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    await prisma.calendarOAuthState.deleteMany({ where: { user_id: parentId } });
  });
});
