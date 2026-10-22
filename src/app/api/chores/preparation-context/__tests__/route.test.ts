/** Authored/unrun. Route admission cases; SQL isolation is a separate DB case. */
jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "next/headers",
  () => require("@/__tests__/helpers/two-household").nextHeadersMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
import { POST } from "../route";
import { db, req } from "@/__tests__/helpers/two-household";
beforeEach(() => db.reset());
it("refuses anonymous, child and teen requests before private lookup", async () => {
  expect(
    (await POST(req({ method: "POST", body: { ids: ["task-a"] } }))).status,
  ).toBe(401);
  for (const as of ["childA", "teenA"] as const) {
    const response = await POST(
      req({ as, method: "POST", body: { ids: ["task-a"] } }),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  }
});
it.each([
  { ids: [] },
  { ids: ["task-a", "task-a"] },
  { ids: Array.from({ length: 301 }, (_, i) => `task-${i}`) },
  { ids: ["task-a"], familyId: "foreign-family" },
  { ids: ["task-a"], owner: { userId: "other-parent" } },
])("rejects invalid windows and supplied authority", async (body) => {
  const response = await POST(req({ as: "parentA", method: "POST", body }));
  expect(response.status).toBe(400);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
