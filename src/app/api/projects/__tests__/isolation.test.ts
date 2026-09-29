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
import { db, req, params, bodyOf, writesTo, expectDenied, expectNoForeignData, type UserKey } from "@/__tests__/helpers/two-household";

describe("projects — two households", () => {
  beforeEach(() => db.reset());

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
});
