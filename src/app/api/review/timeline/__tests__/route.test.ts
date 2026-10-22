/** Authored/unrun two-household API cases, using the established fabricated DB. */
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
import { GET } from "../route";
import {
  db,
  req,
  FAMILY_A,
  expectNoForeignData,
} from "@/__tests__/helpers/two-household";
beforeEach(() => db.reset());
it("refuses anonymous/child/teen sessions and ignores client-supplied family authority", async () => {
  expect((await GET(req())).status).toBe(401);
  for (const as of ["childA", "teenA"] as const)
    expect((await GET(req({ as }))).status).toBe(403);
  const request = req({
    as: "parentA",
    path: "/api/review/timeline",
    query: { familyId: "family-b" },
  });
  expect((await GET(request)).status).toBe(400);
});
it("projects only the current household and does not expose stored activity text or foreign targets", async () => {
  db.rows("activity").push({
    id: "fixture-private-fact",
    family_id: FAMILY_A,
    user_id: "parent-a",
    subject_member_erased: false,
    type: "preparation_changed",
    title: "Private historical text",
    description: "Private old notes",
    metadata: JSON.stringify({
      timeline: 1,
      target: { kind: "event", id: "event-b" },
    }),
    created_at: new Date(),
  });
  const response = await GET(req({ as: "parentA" }));
  expect(response.status).toBe(200);
  const body = await expectNoForeignData(response);
  expect(JSON.stringify(body)).not.toMatch(
    /Private historical|Private old notes/,
  );
  const row = body.entries.find(
    (entry: { id: string }) => entry.id === "activity:fixture-private-fact",
  );
  expect(row).toMatchObject({
    target: null,
    title: null,
    current: "unavailable",
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
