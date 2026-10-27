// Two-household isolation for the projects API (#102): projects, tasks and
// send-to-calendar.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as projects from "../route";
import * as project from "../[id]/route";
import * as tasks from "../[id]/tasks/route";
import * as task from "../[id]/tasks/[taskId]/route";
import { POST as sendToCalendar } from "../[id]/send-to-calendar/route";
import { db, req, params, bodyOf, writesTo, expectDenied, expectNoForeignData, fakePrisma, type UserKey } from "@/__tests__/helpers/two-household";

// The shared in-memory Prisma fixture supports grouped rows but intentionally
// only implements the aggregate shapes used by most routes.  This overview
// asks for Prisma's `_count._all` shape, so provide that narrow adapter here
// while retaining the route's household filter and completed grouping.
const originalProjectTaskGroupBy = fakePrisma.projectTask.groupBy;

describe("projects — two households", () => {
  beforeEach(() => {
    db.reset();
    // The real route gate is mocked in this in-memory suite; keep the helper's
    // transaction-level effective-feature check honest with an enabled family.
    db.find("family", "family-A")!.features = { projects: true };
    db.find("family", "family-B")!.features = { projects: true };
    fakePrisma.projectTask.groupBy = async ({ where }: { where: { project_id: { in: string[] }; project: { family_id: string } } }) => {
      const allowed = new Set(where.project_id.in);
      const grouped = new Map<string, { project_id: string; completed: boolean; count: number }>();
      for (const task of db.rows("projectTask")) {
        if (!allowed.has(String(task.project_id))) continue;
        if (db.find("project", String(task.project_id))?.family_id !== where.project.family_id) continue;
        const key = `${task.project_id}\u0000${Boolean(task.completed)}`;
        const current = grouped.get(key);
        if (current) current.count += 1;
        else grouped.set(key, { project_id: String(task.project_id), completed: Boolean(task.completed), count: 1 });
      }
      return [...grouped.values()].map(({ project_id, completed, count }) => ({
        project_id,
        completed,
        _count: { _all: count },
      }));
    };
  });

  afterEach(() => {
    fakePrisma.projectTask.groupBy = originalProjectTaskGroupBy;
  });

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    const statuses = [
      (await projects.GET(req())).status,
      (await projects.POST(req({ body: { name: "x" } }))).status,
      (await project.GET(req(), params({ id: "proj-a" }))).status,
      (await project.PATCH(req({ body: { name: "x" } }), params({ id: "proj-a" }))).status,
      (await project.DELETE(req(), params({ id: "proj-a" }))).status,
      (await tasks.GET(req(), params({ id: "proj-a" }))).status,
      (await tasks.POST(req({ body: { title: "x" } }), params({ id: "proj-a" }))).status,
      (await task.PATCH(req({ body: { completed: true } }), params({ id: "proj-a", taskId: "task-a" }))).status,
      (await task.DELETE(req(), params({ id: "proj-a", taskId: "task-a" }))).status,
      (await sendToCalendar(req(), params({ id: "proj-a" }))).status,
    ];
    expect(new Set(statuses)).toEqual(new Set([401]));
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's family", async () => {
    const body = await expectNoForeignData(await projects.GET(req({ as: "childA" })));
    expect(body.projects.map((p: any) => p.id)).toEqual(["proj-a"]);
  });

  it("refuses every read and write on another family's project", async () => {
    await expectDenied(await project.GET(req({ as: "parentA" }), params({ id: "proj-b" })));
    await expectDenied(await project.PATCH(req({ as: "parentA", body: { name: "x" } }), params({ id: "proj-b" })));
    await expectDenied(await project.DELETE(req({ as: "parentA" }), params({ id: "proj-b" })));
    await expectDenied(await tasks.GET(req({ as: "parentA" }), params({ id: "proj-b" })));
    await expectDenied(await tasks.POST(req({ as: "parentA", body: { title: "x" } }), params({ id: "proj-b" })));
    await expectDenied(await task.PATCH(req({ as: "parentA", body: { completed: true } }), params({ id: "proj-b", taskId: "task-b" })));
    await expectDenied(await task.DELETE(req({ as: "parentA" }), params({ id: "proj-b", taskId: "task-b" })));
    await expectDenied(await sendToCalendar(req({ as: "parentA" }), params({ id: "proj-b" })));
    expect(db.writes).toHaveLength(0);
  });

  // Route inventory F-5 (#289): the tasks route now has an in-app caller
  // ("Add task" on the project page); its lookups are household-scoped, so a
  // foreign project or assignee is the same 404 as a missing one.
  it("tasks: another household's project is the same 404 as a missing one", async () => {
    for (const call of [
      (id: string) => tasks.GET(req({ as: "parentA" }), params({ id })),
      (id: string) => tasks.POST(req({ as: "childA", body: { title: "x" } }), params({ id })),
    ]) {
      const foreign = await call("proj-b");
      const missing = await call("no-such-project");
      expect([foreign.status, missing.status]).toEqual([404, 404]);
      expect(await bodyOf(foreign)).toEqual(await bodyOf(missing));
      await expectNoForeignData(foreign);
    }
    expect(db.writes).toHaveLength(0);
  });

  it("tasks: a family-B assignee is the same 404 as an unknown user", async () => {
    const foreign = await tasks.POST(req({ as: "parentA", body: { title: "x", assigned_to: "child-b" } }), params({ id: "proj-a" }));
    const missing = await tasks.POST(req({ as: "parentA", body: { title: "x", assigned_to: "nobody" } }), params({ id: "proj-a" }));
    expect([foreign.status, missing.status]).toEqual([404, 404]);
    expect(await bodyOf(foreign)).toEqual(await bodyOf(missing));
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["parentA"], ["teenA"], ["childA"]])("tasks: %s adds a task to their household's active project", async (who) => {
    const res = await tasks.POST(
      req({ as: who, body: { title: "Label boxes", due_date: "2026-10-03", assigned_to: "teen-a", project_id: "proj-b" } }),
      params({ id: "proj-a" })
    );
    expect(res.status).toBe(201);
    const body = await expectNoForeignData(res);
    expect(body.task).toMatchObject({ title: "Label boxes", project_id: "proj-a", assigned_to: "teen-a", position: 1 });
    expect(writesTo("projectTask")[0].args.data).toMatchObject({ project_id: "proj-a" });
    const listed = await expectNoForeignData(await tasks.GET(req({ as: who }), params({ id: "proj-a" })));
    expect(listed.tasks.map((t: any) => t.title)).toEqual(["Home sweep", "Label boxes"]);
  });

  it("tasks: a completed or archived project takes no new task", async () => {
    for (const status of ["completed", "archived"]) {
      db.reset();
      db.find("family", "family-A")!.features = { projects: true };
      db.find("project", "proj-a")!.status = status;
      const res = await tasks.POST(req({ as: "parentA", body: { title: "x" } }), params({ id: "proj-a" }));
      expect(res.status).toBe(400);
      expect(writesTo("projectTask")).toHaveLength(0);
    }
  });

  it("cannot reach a foreign task through the caller's own project id", async () => {
    await expectDenied(await task.PATCH(req({ as: "parentA", body: { completed: true } }), params({ id: "proj-a", taskId: "task-b" })));
    await expectDenied(await task.DELETE(req({ as: "parentA" }), params({ id: "proj-a", taskId: "task-b" })));
    expect(db.writes).toHaveLength(0);
  });

  it("rejects assigning a task to a family-B user", async () => {
    await expectDenied(await tasks.POST(req({ as: "parentA", body: { title: "x", assigned_to: "child-b" } }), params({ id: "proj-a" })));
    await expectDenied(
      await task.PATCH(req({ as: "parentA", body: { assigned_to: "child-b" } }), params({ id: "proj-a", taskId: "task-a" }))
    );
    expect(db.writes).toHaveLength(0);
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s cannot edit or delete projects and tasks", async (who) => {
    expect((await project.PATCH(req({ as: who, body: { name: "x" } }), params({ id: "proj-a" }))).status).toBe(403);
    expect((await project.DELETE(req({ as: who }), params({ id: "proj-a" }))).status).toBe(403);
    expect((await task.PATCH(req({ as: who, body: { completed: true } }), params({ id: "proj-a", taskId: "task-a" }))).status).toBe(403);
    expect((await task.DELETE(req({ as: who }), params({ id: "proj-a", taskId: "task-a" }))).status).toBe(403);
    expect(db.writes).toHaveLength(0);
  });

  it("same-family happy path", async () => {
    const created = await projects.POST(req({ as: "parentA", body: { name: "Attic", family_id: "family-B" } }));
    expect(created.status).toBe(201);
    expect(writesTo("project")[0].args.data).toMatchObject({ family_id: "family-A" });
    const detail = await expectNoForeignData(await project.GET(req({ as: "parentA" }), params({ id: "proj-a" })));
    expect(detail.project.tasks.map((t: any) => t.id)).toEqual(["task-a"]);
    expect((await tasks.POST(req({ as: "parentA", body: { title: "Box", assigned_to: "teen-a" } }), params({ id: "proj-a" }))).status).toBe(201);
    const sent = await sendToCalendar(req({ as: "parentA" }), params({ id: "proj-a" }));
    expect(sent.status).toBe(200);
    for (const w of writesTo("event")) expect(w.args.data.family_id).toBe("family-A");
  });

  it.each<[UserKey]>([["parentA"], ["teenA"], ["childA"]])(
    "D9: %s can create a project with omitted status and keeps active default",
    async (who) => {
      const res = await projects.POST(req({ as: who, body: { name: `${who} project` } }));
      expect(res.status).toBe(201);
      expect((await res.json()).project).toMatchObject({
        name: `${who} project`,
        status: "active",
        family_id: "family-A",
        created_by: who === "parentA" ? "parent-a" : who === "teenA" ? "teen-a" : "child-a",
      });
    },
  );

  it.each<[UserKey]>([["parentA"], ["teenA"], ["childA"]])(
    "D9: %s can create a project with an explicit lifecycle status",
    async (who) => {
      const res = await projects.POST(
        req({ as: who, body: { name: `${who} completed`, status: "completed" } }),
      );
      expect(res.status).toBe(201);
      expect((await res.json()).project).toMatchObject({
        name: `${who} completed`,
        status: "completed",
        family_id: "family-A",
      });
    },
  );

  it("replays a keyed project create once and refuses a replay after the project is gone", async () => {
    const body = { name: "Receipt-safe project", color: "#AABBCC" };
    const headers = { "Idempotency-Key": "project-create-replay-key" };
    const first = await projects.POST(req({ as: "parentA", body, headers }));
    expect(first.status).toBe(201);
    const projectId = (await first.json()).project.id;
    expect(writesTo("project")).toHaveLength(1);

    const replay = await projects.POST(req({ as: "parentA", body, headers }));
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await replay.json()).project.id).toBe(projectId);
    expect(writesTo("project")).toHaveLength(1);

    const rowIndex = db.rows("project").findIndex((row: any) => row.id === projectId);
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    db.rows("project").splice(rowIndex, 1);
    const missing = await projects.POST(req({ as: "parentA", body, headers }));
    expect(missing.status).toBe(404);
  });

  it("replays a keyed task without duplicating the task or project timestamp write", async () => {
    const body = { title: "Receipt-safe task", assigned_to: "teen-a" };
    const headers = { "Idempotency-Key": "project-task-replay-key" };
    const project = db.find("project", "proj-a")!;
    const timestampBefore = project.updated_at;
    const first = await tasks.POST(
      req({ as: "childA", body, headers }),
      params({ id: "proj-a" }),
    );
    expect(first.status).toBe(201);
    const taskId = (await first.json()).task.id;
    const timestampAfterFirst = project.updated_at;
    expect(timestampAfterFirst).not.toBe(timestampBefore);
    expect(writesTo("projectTask")).toHaveLength(1);
    expect(writesTo("project")).toHaveLength(1);

    const replay = await tasks.POST(
      req({ as: "childA", body, headers }),
      params({ id: "proj-a" }),
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect((await replay.json()).task.id).toBe(taskId);
    expect(project.updated_at).toBe(timestampAfterFirst);
    expect(writesTo("projectTask")).toHaveLength(1);
    expect(writesTo("project")).toHaveLength(1);
  });

  it("refuses a keyed task replay after the stored task is deleted", async () => {
    const body = { title: "Receipt-safe deleted task", assigned_to: "teen-a" };
    const headers = { "Idempotency-Key": "project-task-deleted-replay-key" };
    const first = await tasks.POST(
      req({ as: "childA", body, headers }),
      params({ id: "proj-a" }),
    );
    expect(first.status).toBe(201);
    const taskId = (await first.json()).task.id;
    expect(db.rows("projectTask").some((row: any) => row.id === taskId)).toBe(true);

    const rowIndex = db.rows("projectTask").findIndex((row: any) => row.id === taskId);
    expect(rowIndex).toBeGreaterThanOrEqual(0);
    db.rows("projectTask").splice(rowIndex, 1);

    const missing = await tasks.POST(
      req({ as: "childA", body, headers }),
      params({ id: "proj-a" }),
    );
    expect(missing.status).toBe(404);
    expect(await bodyOf(missing)).toEqual({ error: "Task not found" });
    expect(missing.headers.get("Idempotency-Replayed")).toBeNull();
    expect(writesTo("projectTask")).toHaveLength(1);
    expect(writesTo("project")).toHaveLength(1);
  });

  it("rejects a changed task body without adding a second task", async () => {
    const headers = { "Idempotency-Key": "project-task-conflict-key" };
    const first = await tasks.POST(
      req({ as: "parentA", body: { title: "Original task" }, headers }),
      params({ id: "proj-a" }),
    );
    expect(first.status).toBe(201);

    const conflict = await tasks.POST(
      req({ as: "parentA", body: { title: "Changed task" }, headers }),
      params({ id: "proj-a" }),
    );
    expect(conflict.status).toBe(422);
    expect((await bodyOf(conflict)).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(writesTo("projectTask")).toHaveLength(1);
    expect(writesTo("project")).toHaveLength(1);
  });

  it("releases a task receipt after a terminal refusal so the same key can retry", async () => {
    const body = { title: "Retry after archived" };
    const headers = { "Idempotency-Key": "project-task-refusal-retry-key" };
    db.find("project", "proj-a")!.status = "archived";

    const refused = await tasks.POST(
      req({ as: "parentA", body, headers }),
      params({ id: "proj-a" }),
    );
    expect(refused.status).toBe(400);

    db.find("project", "proj-a")!.status = "active";
    const retried = await tasks.POST(
      req({ as: "parentA", body, headers }),
      params({ id: "proj-a" }),
    );
    expect(retried.status).toBe(201);
    expect(writesTo("projectTask")).toHaveLength(1);
    expect(writesTo("project")).toHaveLength(1);
  });

  it("denies a keyed project replay after membership or the effective feature changes", async () => {
    const body = { name: "Membership-bound project" };
    const headers = { "Idempotency-Key": "project-membership-replay-key" };
    expect((await projects.POST(req({ as: "parentA", body, headers }))).status).toBe(201);

    db.find("user", "parent-a")!.family_id = null;
    expect((await projects.POST(req({ as: "parentA", body, headers }))).status).toBe(400);
    db.find("user", "parent-a")!.family_id = "family-A";

    db.find("family", "family-A")!.features = { projects: false };
    expect((await projects.POST(req({ as: "parentA", body, headers }))).status).toBe(403);
  });
});
