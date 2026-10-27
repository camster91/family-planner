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
import { POST as OWNED_POST } from "../[source]/owned/route";
import {
  IMPORT_OWNER_HEADER,
  IMPORT_OWNER_PROTOCOL,
} from "@/lib/imports/import-owner-contract";
import { runFamilyImport } from "@/lib/imports/run-family-import";
import { ImportSessionChangedError } from "@/lib/imports/import-authority";
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
      expect.objectContaining({
        familyId: "family-A",
        startedBy: "parent-a",
        sessionVersion: 0,
      }),
    );
  });
  it("returns an authentication refusal when the persisted importer renews a revoked session", async () => {
    run.mockRejectedValueOnce(new ImportSessionChangedError());
    const res = await POST(
      importReq("parentA", { ...body(), dryRun: false }),
      params({ source: "familywall" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("SESSION_CHANGED");
  });

  it("returns reviewed actor/household only to opted-in previews", async () => {
    const legacy = await POST(
      importReq("parentA", body()),
      params({ source: "familywall" }),
    );
    expect((await legacy.json()).review).toBeUndefined();
    const scoped = await POST(
      importReq("parentA", { ...body(), reviewProtocol: 1 }),
      params({ source: "familywall" }),
    );
    expect((await scoped.json()).review).toEqual({
      protocol: 1,
      actorId: "parent-a",
      familyId: "family-A",
    });
    expect(scoped.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("requires a scope for opted-in persistence before dispatch", async () => {
    const res = await POST(
      importReq("parentA", { ...body(), dryRun: false, reviewProtocol: 1 }),
      params({ source: "familywall" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("IMPORT_REVIEW_REQUIRED");
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    { actorId: "parent-a", familyId: "family-B" },
    { actorId: "parent-b", familyId: "family-A" },
  ])(
    "refuses a changed reviewed actor or household without importing",
    async (expectedScope) => {
      const res = await POST(
        importReq("parentA", {
          ...body(),
          dryRun: false,
          reviewProtocol: 1,
          expectedScope,
        }),
        params({ source: "familywall" }),
      );
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("IMPORT_SCOPE_CHANGED");
      expect(run).not.toHaveBeenCalled();
    },
  );
});

describe("original-owner import path (source cases, unrun)", () => {
  const original = {
    protocol: IMPORT_OWNER_PROTOCOL,
    actorId: "parent-a",
    familyId: "family-A",
    generation: 0,
  };
  beforeEach(() => {
    db.reset();
    run.mockReset().mockResolvedValue({ ok: true });
  });
  it("requires original owner support before source-body parsing or dispatch", async () => {
    const missing = importReq("parentA", { ...body(), reviewProtocol: 1 });
    missing.headers.set("content-length", String(10 * 1024 * 1024 + 1));
    const result = await OWNED_POST(missing, params({ source: "familywall" }));
    expect(result.status).toBe(400);
    expect(await result.json()).toMatchObject({
      code: "IMPORT_OWNER_REQUIRED",
    });
    expect(run).not.toHaveBeenCalled();
  });
  it.each([
    { actorId: "parent-b" },
    { familyId: "family-B" },
    { generation: 1 },
    { protocol: "future" },
  ])(
    "refuses changed/malformed original context before dispatch: %p",
    async (change) => {
      const request = importReq("parentA", { ...body(), reviewProtocol: 1 });
      request.headers.set(
        IMPORT_OWNER_HEADER,
        JSON.stringify({ ...original, ...change }),
      );
      request.headers.set("content-length", String(10 * 1024 * 1024 + 1));
      const result = await OWNED_POST(
        request,
        params({ source: "familywall" }),
      );
      expect(result.status).toBe(409);
      expect(await result.json()).toMatchObject({
        code: "IMPORT_SCOPE_CHANGED",
      });
      expect(run).not.toHaveBeenCalled();
    },
  );
  it("returns the original private context only after a matching reviewed dispatch", async () => {
    const request = importReq("parentA", { ...body(), reviewProtocol: 1 });
    request.headers.set(IMPORT_OWNER_HEADER, JSON.stringify(original));
    const result = await OWNED_POST(request, params({ source: "familywall" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      originalOwner: original,
      review: {
        protocol: 1,
        actorId: original.actorId,
        familyId: original.familyId,
      },
    });
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("does not echo a private result after the actor moves households during dispatch", async () => {
    run.mockImplementationOnce(async () => {
      db.find("user", "parent-a")!.family_id = "family-B";
      return { ok: true };
    });
    const request = importReq("parentA", { ...body(), reviewProtocol: 1 });
    request.headers.set(IMPORT_OWNER_HEADER, JSON.stringify(original));
    const result = await OWNED_POST(request, params({ source: "familywall" }));
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ code: "IMPORT_SCOPE_CHANGED" });
    expect(run).toHaveBeenCalledTimes(1); // Refusal is not rollback proof.
  });
});

it.each(["childA", "teenA"] as const)(
  "strict imports do not treat a forged owner marker as parent authority for %s",
  async (who) => {
    db.reset();
    run.mockClear();
    const request = importReq(who, { ...body(), reviewProtocol: 1 });
    request.headers.set(
      IMPORT_OWNER_HEADER,
      JSON.stringify({
        protocol: IMPORT_OWNER_PROTOCOL,
        actorId: "parent-a",
        familyId: "family-A",
        generation: 0,
      }),
    );
    expect(
      (await OWNED_POST(request, params({ source: "familywall" }))).status,
    ).toBe(403);
    expect(run).not.toHaveBeenCalled();
  },
);
