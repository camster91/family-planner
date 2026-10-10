// Real database writes and removal; barriers pause only the gap between the
// route's initial membership check and its later write. No live data is used.
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/session", () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith("session:")) return null;
    const { prisma } = require("@/lib/prisma");
    const u = await prisma.user.findUnique({ where: { id: token.slice(8) } });
    return u
      ? {
          userId: u.id,
          email: u.email,
          role: u.role,
          family_id: u.family_id,
          tv: u.token_version,
        }
      : null;
  },
  getTokenVersion: async () => 0,
}));
jest.mock(
  "@/lib/notifications-server",
  () => require("@/__tests__/helpers/two-household").notificationsMock,
);
jest.mock("@/lib/notification-delivery", () => {
  const actual = jest.requireActual("@/lib/notification-delivery");
  return {
    ...actual,
    deliverNotification: async (...args: any[]) => {
      await mockNotificationBarrier?.();
      return actual.deliverNotification(...args);
    },
  };
});
jest.mock("@/lib/chore-photos", () => {
  const actual = jest.requireActual("@/lib/chore-photos");
  return {
    ...actual,
    resolveChorePhotoForWrite: async (...args: any[]) => {
      const result = await actual.resolveChorePhotoForWrite(...args);
      await mockChoreBarrier?.();
      return result;
    },
  };
});

let mockNotificationBarrier: (() => Promise<void>) | undefined;
let mockChoreBarrier: (() => Promise<void>) | undefined;

function barrier() {
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    reached,
    release,
    pause: async () => {
      entered();
      await wait;
    },
  };
}

const withDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(30_000);

withDatabase("membership removal versus pending writes (#469)", () => {
  const familyId = "race469-home";
  const otherId = "race469-other";
  const actorId = "race469-parent";
  const targetId = "race469-child";
  let db: NonNullable<typeof import("@/lib/prisma").prisma>;
  let remove: typeof import("@/lib/member-removal").removeHouseholdMember;
  let notificationRoute: typeof import("@/app/api/notifications/route");
  let choreRoute: typeof import("@/app/api/chores/create/route");

  const request = (body: unknown): any => ({
    method: "POST",
    url: "http://localhost/api/test",
    headers: new Headers(),
    cookies: {
      get: (name: string) =>
        name === "session_token" ? { value: `session:${actorId}` } : undefined,
    },
    json: async () => body,
  });

  async function cleanup() {
    await db.notification.deleteMany({
      where: { user_id: { in: [actorId, targetId] } },
    });
    await db.chore.deleteMany({
      where: { family_id: { in: [familyId, otherId] } },
    });
    await db.auditLog.deleteMany({
      where: { family_id: { in: [familyId, otherId] } },
    });
    await db.family.deleteMany({ where: { id: { in: [familyId, otherId] } } });
    await db.user.deleteMany({ where: { id: { in: [actorId, targetId] } } });
  }

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma!;
    if (!db) throw new Error("Disposable database is required");
    remove = (await import("@/lib/member-removal")).removeHouseholdMember;
    notificationRoute = await import("@/app/api/notifications/route");
    choreRoute = await import("@/app/api/chores/create/route");
  });
  beforeEach(async () => {
    await cleanup();
    await db.family.createMany({
      data: [
        { id: familyId, name: "Race test home", invite_code: "race469-code" },
        {
          id: otherId,
          name: "Other race test home",
          invite_code: "race469-other-code",
        },
      ],
    });
    await db.user.createMany({
      data: [
        {
          id: actorId,
          email: "parent@race469.test",
          name: "Test Parent",
          role: "parent",
          family_id: familyId,
        },
        {
          id: targetId,
          email: "child@race469.test",
          name: "Test Child",
          role: "child",
          family_id: familyId,
        },
      ],
    });
  });
  afterEach(async () => {
    mockNotificationBarrier = undefined;
    mockChoreBarrier = undefined;
    await cleanup();
  });

  async function detachAndRejoin(removedId = targetId, removingId = actorId) {
    await remove({ actorId: removingId, familyId, targetId: removedId });
    const { lockUser, lockHouseholdForJoin } =
      await import("@/lib/household-lock");
    // Use the same lock order as canonical joining; no production fixture.
    await db.$transaction(async (tx) => {
      await lockUser(tx, removedId);
      expect(await lockHouseholdForJoin(tx, otherId)).toBe(true);
      await tx.user.update({
        where: { id: removedId },
        data: { family_id: otherId, name: "OTHER HOUSEHOLD PROFILE" },
      });
    });
  }

  it("does not recreate an old-household notification after removal cleanup", async () => {
    const gate = barrier();
    mockNotificationBarrier = gate.pause;
    const pending = notificationRoute.POST(
      request({
        userId: targetId,
        title: "Private old home",
        message: "Old household details",
        type: "system",
      }),
    );
    await gate.reached;
    try {
      await detachAndRejoin();
    } finally {
      gate.release();
    }
    const response = await pending;
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      delivered: false,
      notification: null,
    });
    expect(await db.notification.count({ where: { user_id: targetId } })).toBe(
      0,
    );
  });

  it("does not create a chore assigned to a member removed after initial validation", async () => {
    const gate = barrier();
    mockChoreBarrier = gate.pause;
    const pending = choreRoute.POST(
      request({
        title: "Race test chore",
        assigned_to: targetId,
        due_date: new Date().toISOString().slice(0, 10),
        frequency: "once",
      }),
    );
    await gate.reached;
    try {
      await detachAndRejoin();
    } finally {
      gate.release();
    }
    const response = await pending;
    expect(response.status).toBe(400);
    expect(
      await db.chore.count({
        where: { family_id: familyId, assigned_to: targetId },
      }),
    ).toBe(0);
  });

  it("refuses a rotation when a later participant leaves before insertion", async () => {
    const gate = barrier();
    mockChoreBarrier = gate.pause;
    const pending = choreRoute.POST(
      request({
        title: "Race test rotation",
        rotation: [actorId, targetId],
        due_date: new Date().toISOString().slice(0, 10),
        frequency: "weekly",
      }),
    );
    await gate.reached;
    try {
      await detachAndRejoin();
    } finally {
      gate.release();
    }
    expect((await pending).status).toBe(400);
    expect(await db.chore.count({ where: { family_id: familyId } })).toBe(0);
  });

  it("refuses a pending manual notification when its sender leaves", async () => {
    await db.user.update({ where: { id: targetId }, data: { role: "parent" } });
    const gate = barrier();
    mockNotificationBarrier = gate.pause;
    const pending = notificationRoute.POST(
      request({
        userId: targetId,
        title: "Private old home",
        message: "Old household details",
        type: "system",
      }),
    );
    await gate.reached;
    try {
      await detachAndRejoin(actorId, targetId);
    } finally {
      gate.release();
    }
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      delivered: false,
      notification: null,
    });
    expect(await db.notification.count({ where: { user_id: targetId } })).toBe(
      0,
    );
  });
});
