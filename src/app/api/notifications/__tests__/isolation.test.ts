// Two-household isolation for /api/notifications (#102). Notifications are
// user-scoped; creating one for someone else is parent-only and same-family.

jest.mock("next/server", () => require("@/__tests__/helpers/two-household").nextServerMock);
jest.mock("next/headers", () => require("@/__tests__/helpers/two-household").nextHeadersMock);
jest.mock("@/lib/session", () => require("@/__tests__/helpers/two-household").sessionMock);
jest.mock("@/lib/prisma", () => ({ prisma: require("@/__tests__/helpers/two-household").fakePrisma }));
jest.mock("@/lib/feature-gate-server", () => ({ featureGate: async () => null }));

import * as notifications from "../route";
import { db, req, writesTo, expectDenied, expectNoForeignData } from "@/__tests__/helpers/two-household";

const note = { userId: "child-a", title: "Hi", message: "Dinner", type: "system" };

describe("notifications — two households", () => {
  beforeEach(() => db.reset());

  it("returns 401 to an unauthenticated caller on every handler", async () => {
    expect((await notifications.GET(req())).status).toBe(401);
    expect((await notifications.POST(req({ body: note }))).status).toBe(401);
    expect((await notifications.PATCH(req({ body: { markAll: true } }))).status).toBe(401);
    expect((await notifications.DELETE(req({ body: { clearAll: true } }))).status).toBe(401);
    expect(db.writes).toHaveLength(0);
  });

  it("lists only the caller's own notifications", async () => {
    const body = await expectNoForeignData(await notifications.GET(req({ as: "parentA" })));
    expect(body.notifications.map((n: any) => n.id)).toEqual(["notif-a"]);
  });

  it("refuses to notify a user in another family", async () => {
    await expectDenied(await notifications.POST(req({ as: "parentA", body: { ...note, userId: "child-b" } })));
    expect(writesTo("notification")).toHaveLength(0);
  });

  it("a child cannot create notifications", async () => {
    expect((await notifications.POST(req({ as: "childA", body: note }))).status).toBe(403);
    expect(writesTo("notification")).toHaveLength(0);
  });

  it("cannot mark read or delete someone else's notification", async () => {
    await expectDenied(await notifications.PATCH(req({ as: "parentA", body: { notificationId: "notif-b" } })));
    await expectDenied(await notifications.DELETE(req({ as: "parentA", body: { notificationId: "notif-b" } })));
    expect(db.find("notification", "notif-b")?.read).toBe(false);
  });

  it("a parent can notify a same-family member", async () => {
    expect((await notifications.POST(req({ as: "parentA", body: note }))).status).toBe(200);
    expect(writesTo("notification")[0].args.data).toMatchObject({ user_id: "child-a" });
  });
});
