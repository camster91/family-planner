// Real-Postgres check of the import upsert key and reconcile SQL (#232).
// Opt-in like the other integration suites: RUN_DB_INTEGRATION=1 DATABASE_URL=...

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

describeWithDatabase("calendar import persistence (Postgres)", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  const familyId = "calimport-family";
  const otherFamilyId = "calimport-family-2";
  const parentId = "calimport-parent";
  const otherParentId = "calimport-parent-2";
  const NOW = new Date("2026-09-15T12:00:00Z");

  const FEED = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:club@school.test",
    "DTSTART;TZID=America/Toronto:20260921T153000",
    "DTEND;TZID=America/Toronto:20260921T163000",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:Robotics club",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  beforeAll(async () => {
    const prismaModule = await import("@/lib/prisma");
    if (!prismaModule.prisma)
      throw new Error("Integration database is not configured");
    prisma = prismaModule.prisma;
    await prisma.family.createMany({
      data: [
        { id: familyId, name: "Cal Import", invite_code: "calimport-invite" },
        {
          id: otherFamilyId,
          name: "Cal Import 2",
          invite_code: "calimport-invite-2",
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: parentId,
          email: "p@calimport.test",
          name: "P",
          role: "parent",
          family_id: familyId,
        },
        {
          id: otherParentId,
          email: "p2@calimport.test",
          name: "P2",
          role: "parent",
          family_id: otherFamilyId,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.family.deleteMany({
      where: { id: { in: [familyId, otherFamilyId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [parentId, otherParentId] } },
    });
    await prisma.$disconnect();
  });

  it("imports idempotently, enforces the unique key, and removal cascades only its events", async () => {
    const { syncSubscription, removeSubscription } = await import("../sync");
    const { encryptSecret } = await import("@/lib/secret-box");
    const sub = await prisma.calendarSubscription.create({
      data: {
        family_id: familyId,
        name: "School",
        url_enc: encryptSecret("https://cal.example.com/a.ics"),
        created_by: parentId,
      },
    });
    const local = await prisma.event.create({
      data: {
        family_id: familyId,
        title: "Local",
        start_time: new Date("2026-09-22T12:00:00Z"),
        end_time: new Date("2026-09-22T13:00:00Z"),
        created_by: parentId,
      },
    });
    const opts = {
      now: NOW,
      assertUrl: async () => undefined,
      fetchImpl: async () => new Response(FEED, { status: 200 }),
    };

    expect(await syncSubscription(sub.id, familyId, opts)).toMatchObject({
      status: "ok",
      created: 3,
    });
    expect(await syncSubscription(sub.id, familyId, opts)).toMatchObject({
      status: "ok",
      created: 0,
      updated: 0,
    });
    expect(
      await prisma.event.count({ where: { source_subscription_id: sub.id } }),
    ).toBe(3);

    // The unique index rejects a duplicate occurrence row outright.
    const one = await prisma.event.findFirstOrThrow({
      where: { source_subscription_id: sub.id },
    });
    await expect(
      prisma.event.create({
        data: {
          family_id: familyId,
          title: "dup",
          start_time: one.start_time,
          end_time: one.end_time,
          created_by: parentId,
          source_subscription_id: sub.id,
          source_uid: one.source_uid,
          source_occurrence_start: one.source_occurrence_start,
        },
      }),
    ).rejects.toThrow();

    // Wrong family: nothing happens.
    expect(await syncSubscription(sub.id, otherFamilyId, opts)).toBeNull();
    expect(await removeSubscription(prisma, sub.id, otherFamilyId)).toBe(0);

    expect(await removeSubscription(prisma, sub.id, familyId)).toBe(3);
    expect(
      await prisma.event.findUnique({ where: { id: local.id } }),
    ).not.toBeNull();
    expect(
      await prisma.calendarSubscription.findUnique({ where: { id: sub.id } }),
    ).toBeNull();
  });
});

export {};
