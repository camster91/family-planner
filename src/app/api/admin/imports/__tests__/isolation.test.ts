// Two-household + parent-only isolation for the import admin API (#102).

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
jest.mock("@/lib/imports/run-family-import", () => ({
  isFamilyImportSource: (s: string) => s === "familywall",
  runFamilyImport: jest.fn(async () => ({ ok: true })),
}));

import { GET } from "../route";
import { POST } from "../[source]/route";
import { runFamilyImport } from "@/lib/imports/run-family-import";
import {
  db,
  req,
  params,
  expectNoForeignData,
  type UserKey,
} from "@/__tests__/helpers/two-household";

const run = runFamilyImport as jest.Mock;
const body = (identityMap: Record<string, string> = {}) => ({
  data: {},
  identityMap,
  dryRun: true,
});
function importReq(as: UserKey | null, payload: unknown) {
  const r = req({ as, body: payload });
  r.headers.set("content-length", "10");
  return r;
}

describe("admin imports — two households, parent only", () => {
  beforeEach(() => {
    db.reset();
    run.mockClear();
  });

  it("returns 401 without a session", async () => {
    expect((await GET(req())).status).toBe(401);
    expect(
      (await POST(importReq(null, body()), params({ source: "familywall" })))
        .status,
    ).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it.each<[UserKey]>([["teenA"], ["childA"]])("%s is refused", async (who) => {
    expect((await GET(req({ as: who }))).status).toBe(403);
    expect(
      (await POST(importReq(who, body()), params({ source: "familywall" })))
        .status,
    ).toBe(403);
    expect(run).not.toHaveBeenCalled();
  });

  it("lists only the caller's family jobs", async () => {
    const res = await expectNoForeignData(await GET(req({ as: "parentA" })));
    expect(res.jobs.map((j: any) => j.id)).toEqual(["job-a"]);
  });

  it("rejects an identity map that points at a family-B user", async () => {
    const res = await POST(
      importReq("parentA", body({ legacy1: "child-a", legacy2: "child-b" })),
      params({ source: "familywall" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).invalidUserIds).toEqual(["child-b"]);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the import into the caller's family only", async () => {
    const res = await POST(
      importReq("parentA", body({ legacy1: "child-a" })),
      params({ source: "familywall" }),
    );
    expect(res.status).toBe(200);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({ familyId: "family-A", startedBy: "parent-a" }),
    );
  });
});
