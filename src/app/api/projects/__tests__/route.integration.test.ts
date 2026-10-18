// Database-backed Project POST coverage. This suite is opt-in and must run
// against a disposable database prepared by scripts/migrate.js:
// RUN_DB_INTEGRATION=1 DATABASE_URL=postgresql://... jest ... --runInBand

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

import { defaultFeatures } from "@/lib/features";

export {};

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase("Project POST routes against Postgres", () => {
  let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
  let projectsRoute: typeof import("../route");
  let tasksRoute: typeof import("../[id]/tasks/route");

  const FAMILY = "prjrcptint-family";
  const USERS = {
    parent: "prjrcptint-parent",
    teen: "prjrcptint-teen",
    child: "prjrcptint-child",
  } as const;
  const PROJECT = "prjrcptint-active";

  function request(
    userId: string,
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): any {
    const url = new URL(`http://localhost${path}`);
    return {
      method: "POST",
      url: url.toString(),
      nextUrl: url,
      headers: new Headers(headers),
      cookies: {
        get: (name: string) =>
          name === "session_token" ? { value: `session:${userId}` } : undefined,
      },
      json: async () => body,
    };
  }

  function taskRequest(
    userId: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) {
    return request(userId, `/api/projects/${PROJECT}/tasks`, body, headers);
  }

  async function cleanup() {
    await prisma.family.deleteMany({ where: { id: FAMILY } });
    await prisma.user.deleteMany({
      where: { id: { in: Object.values(USERS) } },
    });
  }

  beforeAll(async () => {
    const mod = await import("@/lib/prisma");
    if (!mod.prisma) throw new Error("Integration database is not configured");
    prisma = mod.prisma;
    projectsRoute = await import("../route");
    tasksRoute = await import("../[id]/tasks/route");
    await cleanup();
    await prisma.family.create({
      data: {
        id: FAMILY,
        name: "Project receipt integration",
        invite_code: "prjrcptint-invite",
        features: { ...defaultFeatures(), projects: true },
      },
    });
    await prisma.user.createMany({
      data: [
        {
          id: USERS.parent,
          email: "prjrcptint-parent@test",
          name: "Parent",
          role: "parent",
          family_id: FAMILY,
        },
        {
          id: USERS.teen,
          email: "prjrcptint-teen@test",
          name: "Teen",
          role: "teen",
          family_id: FAMILY,
        },
        {
          id: USERS.child,
          email: "prjrcptint-child@test",
          name: "Child",
          role: "child",
          family_id: FAMILY,
        },
      ],
    });
    await prisma.project.create({
      data: {
        id: PROJECT,
        family_id: FAMILY,
        name: "Active seed",
        created_by: USERS.parent,
      },
    });
  });

  afterAll(cleanup);

  it.each(Object.entries(USERS))(
    "%s can create a project with omitted status",
    async (_role, userId) => {
      const response = await projectsRoute.POST(
        request(userId, "/api/projects", { name: `Omitted ${userId}` }),
      );
      expect(response.status).toBe(201);
      expect((await response.json()).project).toMatchObject({
        family_id: FAMILY,
        created_by: userId,
        status: "active",
      });
    },
  );

  it.each(Object.entries(USERS))(
    "%s preserves an explicit project status",
    async (_role, userId) => {
      const response = await projectsRoute.POST(
        request(userId, "/api/projects", {
          name: `Completed ${userId}`,
          status: "completed",
        }),
      );
      expect(response.status).toBe(201);
      expect((await response.json()).project).toMatchObject({
        family_id: FAMILY,
        created_by: userId,
        status: "completed",
      });
    },
  );

  it("stores one project and replays its receipt without a second write", async () => {
    const key = "prjrcptint-project-replay";
    const body = { name: "Keyed project", color: "#123456" };
    const first = await projectsRoute.POST(
      request(USERS.parent, "/api/projects", body, { "Idempotency-Key": key }),
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const replay = await projectsRoute.POST(
      request(USERS.parent, "/api/projects", body, { "Idempotency-Key": key }),
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await replay.json()).project.id).toBe(firstBody.project.id);
    expect(
      await prisma.project.count({
        where: { family_id: FAMILY, name: "Keyed project" },
      }),
    ).toBe(1);

    await prisma.project.delete({ where: { id: firstBody.project.id } });
    const missing = await projectsRoute.POST(
      request(USERS.parent, "/api/projects", body, { "Idempotency-Key": key }),
    );
    expect(missing.status).toBe(404);
  });

  it.each(Object.entries(USERS))(
    "%s can create a task and replay it without a second task",
    async (_role, userId) => {
      const key = `prjrcptint-task-${userId}`;
      const body = { title: `Task ${userId}`, assigned_to: USERS.teen };
      const first = await tasksRoute.POST(
        taskRequest(userId, body, { "Idempotency-Key": key }),
        { params: Promise.resolve({ id: PROJECT }) },
      );
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const replay = await tasksRoute.POST(
        taskRequest(userId, body, { "Idempotency-Key": key }),
        { params: Promise.resolve({ id: PROJECT }) },
      );
      expect(replay.status).toBe(201);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect((await replay.json()).task.id).toBe(firstBody.task.id);
      expect(
        await prisma.projectTask.count({
          where: { project_id: PROJECT, title: `Task ${userId}` },
        }),
      ).toBe(1);
    },
  );
});
