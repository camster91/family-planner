/** Authored disposable-Postgres cases only; execution is deferred. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/session", () => ({
  verifySessionToken: async (token: string) => {
    if (!token?.startsWith("session:")) return null;
    const { prisma } = require("@/lib/prisma");
    const user = await prisma.user.findUnique({
      where: { id: token.slice(8) },
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
import { Client } from "pg";
const describeDb =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;
jest.setTimeout(60000);
describeDb("canonical list creation and private cover lifecycle", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  let POST: typeof import("../create/route").POST;
  let locks: typeof import("@/lib/household-lock");
  const HOME = "lcint-home",
    OTHER = "lcint-other",
    USER = "lcint-user",
    OTHER_USER = "lcint-other-user";
  const filename = "abababababababab.jpg",
    cover = `/api/files/chores/${filename}`;
  function request(withCover: boolean): any {
    return {
      headers: new Headers(),
      cookies: {
        get: (key: string) =>
          key === "session_token" ? { value: `session:${USER}` } : undefined,
      },
      json: async () => ({
        name: "Private fixture checklist",
        type: "custom",
        ...(withCover ? { image_url: cover } : {}),
      }),
    };
  }
  async function cleanup() {
    await prisma.list.deleteMany({
      where: { family_id: { in: [HOME, OTHER] } },
    });
    await prisma.upload.deleteMany({
      where: { family_id: { in: [HOME, OTHER] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER_USER] } } });
    await prisma.family.deleteMany({ where: { id: { in: [HOME, OTHER] } } });
  }
  // Observe an actual blocked request before changing its authenticated state.
  async function held<T>(
    key: string,
    action: () => Promise<T>,
    change: () => Promise<void>,
  ) {
    const holder = new Client({ connectionString: process.env.DATABASE_URL });
    let pending: Promise<T> | undefined;
    const observer = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await holder.connect();
      await observer.connect();
      await holder.query("BEGIN");
      const { rows } = await holder.query("SELECT pg_backend_pid() AS pid");
      const pid = Number(rows[0].pid);
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
      pending = action();
      let blocked = false;
      const until = Date.now() + 5000;
      while (Date.now() < until) {
        const { rows: found } = await observer.query<{ blocked: boolean }>(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE $1 = ANY(pg_blocking_pids(a.pid))) AS blocked",
          [pid],
        );
        if (found[0]?.blocked) {
          blocked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!blocked)
        throw new Error("Expected request did not reach the held lock");
      await change();
      await holder.query("COMMIT");
      return await pending;
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      if (pending) await Promise.allSettled([pending]);
      await observer.end();
      await holder.end();
    }
  }
  beforeAll(async () => {
    prisma = (await import("@/lib/prisma")).prisma!;
    POST = (await import("../create/route")).POST;
    locks = await import("@/lib/household-lock");
    await cleanup();
    await prisma.family.createMany({
      data: [
        { id: HOME, name: "List cover fixture", invite_code: "lcint-invite" },
        { id: OTHER, name: "Other fixture", invite_code: "lcint-other-invite" },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: USER,
          name: "Parent fixture",
          email: "parent@lcint.test",
          role: "parent",
          family_id: HOME,
        },
        {
          id: OTHER_USER,
          name: "Other fixture",
          email: "other@lcint.test",
          role: "parent",
          family_id: OTHER,
        },
      ],
    });
  });
  beforeEach(async () => {
    await prisma.list.deleteMany({ where: { family_id: HOME } });
    await prisma.upload.deleteMany({ where: { family_id: HOME } });
    await prisma.user.update({
      where: { id: USER },
      data: { family_id: HOME, role: "parent", token_version: 0 },
    });
    await prisma.upload.create({
      data: {
        id: "lcint-upload",
        family_id: HOME,
        uploaded_by: USER,
        filename,
        content_type: "image/jpeg",
        size_bytes: 100,
        created_at: new Date("2020-01-01"),
      },
    });
  });
  afterAll(cleanup);
  it.each([false, true])(
    "refuses a captured revoked request after a held actor lock (cover %s)",
    async (withCover) => {
      const result = await held(
        locks.userLockKey(USER),
        () => POST(request(withCover)),
        async () => {
          await prisma.user.update({
            where: { id: USER },
            data: { token_version: { increment: 1 } },
          });
        },
      );
      expect(result.status).toBe(401);
      expect(await prisma.list.count({ where: { family_id: HOME } })).toBe(0);
    },
  );
  it("refuses a cover removed by cleanup before the waiting attachment acquires the household lock", async () => {
    const result = await held(
      locks.householdLockKey(HOME),
      () => POST(request(true)),
      async () => {
        await prisma.upload.delete({ where: { id: "lcint-upload" } });
      },
    );
    expect(result.status).toBe(400);
    expect(await prisma.list.count({ where: { family_id: HOME } })).toBe(0);
  });
  it("retains an attached cover when stale cleanup picked its candidate before the attachment committed", async () => {
    const { pruneUnreferencedUploads } =
      await import("@/lib/upload-housekeeping");
    let attached = false;
    const db = new Proxy(prisma, {
      get(target, key) {
        if (key === "upload")
          return new Proxy(target.upload, {
            get(delegate, method) {
              if (method === "findMany")
                return async (args: any) => {
                  const rows = await delegate.findMany(args);
                  if (!attached && args.where?.created_at?.lt) {
                    attached = true;
                    expect((await POST(request(true))).status).toBe(200);
                  }
                  return rows;
                };
              const value = Reflect.get(delegate, method);
              return typeof value === "function" ? value.bind(delegate) : value;
            },
          });
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const removeFile = jest.fn();
    expect(
      await pruneUnreferencedUploads(db, HOME, {
        uploadDir: "/tmp/list-cover-fixture",
        removeFile,
      }),
    ).toBe(0);
    expect(attached).toBe(true);
    expect(removeFile).not.toHaveBeenCalled();
    expect(
      await prisma.upload.findUnique({ where: { id: "lcint-upload" } }),
    ).not.toBeNull();
    expect(
      await prisma.list.count({ where: { family_id: HOME, image_url: cover } }),
    ).toBe(1);
  });
  it("resolves an uncommitted owned upload through the supplied transaction and rolls it back", async () => {
    const { resolveChorePhotoForWrite } = await import("@/lib/chore-photos");
    const name = "cdcdcdcdcdcdcdcd.jpg";
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.upload.create({
          data: {
            id: "lcint-uncommitted",
            family_id: HOME,
            uploaded_by: USER,
            filename: name,
            content_type: "image/jpeg",
            size_bytes: 100,
          },
        });
        expect(
          await resolveChorePhotoForWrite(
            HOME,
            `/api/files/chores/${name}`,
            undefined,
            tx,
          ),
        ).toEqual({ ok: true, value: `/api/files/chores/${name}` });
        throw new Error("rollback fixture");
      }),
    ).rejects.toThrow("rollback fixture");
    expect(
      await prisma.upload.findUnique({ where: { id: "lcint-uncommitted" } }),
    ).toBeNull();
    expect(await prisma.list.count({ where: { family_id: OTHER } })).toBe(0);
  });
});
