/**
 * Guarded real-Postgres route contract for dormant household profiles (#480).
 *
 * RUN_DB_INTEGRATION=1 is still required. The Next/auth/device boundary is
 * mocked deliberately: this suite exercises the real Prisma route helper and
 * profile command transaction without making a real login or network call.
 */
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

const dbDescribe =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

const mockRuntime: { prisma: PrismaClient | null } = { prisma: null };
const mockActors = {
  parentA: {
    userId: "fx_profile_http_parent_a",
    familyId: "fx_profile_http_a",
    role: "parent",
  },
  teenA: {
    userId: "fx_profile_http_teen_a",
    familyId: "fx_profile_http_a",
    role: "teen",
  },
  parentB: {
    userId: "fx_profile_http_parent_b",
    familyId: "fx_profile_http_b",
    role: "parent",
  },
} as const;
type MockActor = keyof typeof mockActors;

jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/prisma", () => ({
  get prisma() {
    if (!mockRuntime.prisma)
      throw new Error("real profile route client is not ready");
    return mockRuntime.prisma;
  },
}));
jest.mock("@/lib/device-route", () => ({
  refusePairedDevice: jest.fn(async () => null),
}));
jest.mock("@/lib/api-auth", () => {
  const { NextResponse } = require("next/server");
  return {
    authenticateWithFamily: jest.fn(async (request: { headers: Headers }) => {
      const actor =
        mockActors[request.headers.get("x-test-actor") as MockActor] ??
        mockActors.parentA;
      return [
        {
          payload: { userId: actor.userId, tv: 0 },
          user: {
            id: actor.userId,
            family_id: actor.familyId,
            role: actor.role,
          },
        },
        null,
      ];
    }),
    requireParent: jest.fn((role: string) =>
      role === "parent"
        ? null
        : NextResponse.json(
            { error: "Only parents can perform this action" },
            { status: 403 },
          ),
    ),
  };
});

import { GET, POST as createProfile } from "../route";
import { PATCH } from "../[id]/route";
import { POST as archiveProfile } from "../[id]/archive/route";
import { toProfileDto } from "@/lib/household-profile-http";
import { bodyOf, params } from "@/__tests__/helpers/two-household";

const A = mockActors.parentA.familyId;
const B = mockActors.parentB.familyId;
const P = mockActors.parentA.userId;
const T = mockActors.teenA.userId;
const BP = mockActors.parentB.userId;
const PROFILE_A = `${A}-profile`;
const ARCHIVED_A = `${A}-archived`;
const MAPPED_A = `${A}-mapped`;
const LINKED_A = `${A}-linked`;
const ERASED_A = `${A}-erased`;
const PROFILE_B = `${B}-profile`;
const CREATE_KEY = "profile-http-create-0001";
const EDIT_KEY = "profile-http-edit-0001";
const ARCHIVE_KEY = "profile-http-archive-01";

async function loadDatabase(): Promise<PrismaClient> {
  const configuredModule = process.env.HOUSEHOLD_PROFILE_PRISMA_CLIENT_MODULE;
  // Routes intentionally use the proxy above; the admitted database module
  // must bypass that proxy even when its absolute path resolves to prisma.ts.
  const loaded = jest.requireActual(configuredModule ?? "@/lib/prisma") as unknown;
  const candidate = loaded as {
    prisma?: unknown;
    default?: { prisma?: unknown } | unknown;
  };
  const configured =
    candidate.prisma ??
    (candidate.default &&
    typeof candidate.default === "object" &&
    "prisma" in candidate.default
      ? (candidate.default as { prisma: unknown }).prisma
      : candidate.default) ??
    loaded;
  if (!configured || typeof configured !== "object") {
    throw new Error(
      "Profile route integration needs a generated Prisma client module.",
    );
  }
  const db = configured as PrismaClient;
  if (!db.householdMember) {
    throw new Error("Profile route integration needs HouseholdMember models.");
  }
  return db;
}

function request(
  actor: MockActor,
  method: string,
  body?: unknown,
  key?: string,
): any {
  const headers = new Headers({
    "x-test-actor": actor,
    "x-request-id": `profile-http-${actor}`,
  });
  if (key) headers.set("Idempotency-Key", key);
  return {
    method,
    headers,
    cookies: { get: () => undefined },
    json: async () => {
      if (body === undefined) throw new SyntaxError("missing JSON");
      return body;
    },
  };
}

function routeParams(id: string) {
  return params({ id });
}

dbDescribe(
  "dormant household profile HTTP routes against guarded PostgreSQL",
  () => {
    let db: PrismaClient;
    const initialProfileSetupEnabled =
      process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;

    async function clean() {
      if (!db) return;
      await db.householdMemberAccountLink.deleteMany({
        where: { family_id: { in: [A, B] } },
      });
      await db.householdMemberLegacyMapping.deleteMany({
        where: { family_id: { in: [A, B] } },
      });
      await db.householdMember.deleteMany({
        where: { family_id: { in: [A, B] } },
      });
      await db.user.deleteMany({ where: { id: { in: [P, T, BP] } } });
      await db.family.deleteMany({ where: { id: { in: [A, B] } } });
    }

    beforeAll(async () => {
      // This guard must precede client loading, migration and every query.
      assertFixtureTargetAllowed(process.env);
      process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED = "1";
      db = await loadDatabase();
      mockRuntime.prisma = db;
      const pg = await import("pg");
      const sqlDb = new pg.Client({
        connectionString: process.env.DATABASE_URL,
      });
      await sqlDb.connect();
      try {
        await sqlDb.query(
          fs.readFileSync(
            path.resolve(
              __dirname,
              "../../../../../../database/migration-household-members.sql",
            ),
            "utf8",
          ),
        );
      } finally {
        await sqlDb.end();
      }
    });

    beforeEach(async () => {
      await clean();
      await db.family.createMany({
        data: [
          { id: A, name: A, invite_code: A },
          { id: B, name: B, invite_code: B },
        ],
      });
      await db.user.createMany({
        data: [
          {
            id: P,
            family_id: A,
            role: "parent",
            name: P,
            email: `${P}@example.test`,
          },
          {
            id: T,
            family_id: A,
            role: "teen",
            name: T,
            email: `${T}@example.test`,
          },
          {
            id: BP,
            family_id: B,
            role: "parent",
            name: BP,
            email: `${BP}@example.test`,
          },
        ],
      });
    });

    afterAll(async () => {
      await clean();
      mockRuntime.prisma = null;
      if (db) await db.$disconnect();
      if (initialProfileSetupEnabled === undefined)
        delete process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED;
      else
        process.env.HOUSEHOLD_PROFILE_SETUP_ENABLED =
          initialProfileSetupEnabled;
    });

    it("reads only unlinked profiles from the current family and fails closed on a malformed role", async () => {
      await db.householdMember.createMany({
        data: [
          {
            id: PROFILE_A,
            family_id: A,
            name: "Toddler",
            role: "child",
            age: 3,
          },
          {
            id: ARCHIVED_A,
            family_id: A,
            name: "Archived",
            role: "teen",
            age: 15,
            archived_at: new Date("2026-01-02T00:00:00Z"),
            revision: 2,
          },
          { id: MAPPED_A, family_id: A, name: "Mapped", role: "child", age: 6 },
          { id: LINKED_A, family_id: A, name: "Linked", role: "child", age: 7 },
          {
            id: ERASED_A,
            family_id: A,
            name: "Erased",
            role: "child",
            age: 8,
            archived_at: new Date("2026-01-03T00:00:00Z"),
            erasure_user_id: P,
          },
          {
            id: PROFILE_B,
            family_id: B,
            name: "Foreign",
            role: "child",
            age: 9,
          },
        ],
      });
      await db.householdMemberLegacyMapping.create({
        data: { member_id: MAPPED_A, user_id: T, family_id: A },
      });
      await db.householdMemberAccountLink.create({
        data: {
          member_id: LINKED_A,
          user_id: P,
          family_id: A,
          verified_at: new Date(),
        },
      });

      const response = await GET(request("parentA", "GET"));
      expect(response.status).toBe(200);
      const body = await bodyOf(response);
      expect(body.profiles).toEqual([
        expect.objectContaining({
          id: PROFILE_A,
          name: "Toddler",
          role: "child",
        }),
        expect.objectContaining({
          id: ARCHIVED_A,
          name: "Archived",
          archived_at: "2026-01-02T00:00:00.000Z",
        }),
      ]);
      expect(JSON.stringify(body)).not.toContain("Foreign");
      expect(JSON.stringify(body)).not.toContain("email");

      // The migration CHECK rejects malformed roles before they can be stored.
      await expect(
        db.householdMember.create({
          data: {
            id: `${A}-malformed`,
            family_id: A,
            name: "Malformed",
            role: "owner",
            age: null,
          },
        }),
      ).rejects.toThrow();
      // The DTO remains fail-closed for legacy/imported data outside that CHECK.
      expect(toProfileDto({ ...body.profiles[0], role: "owner" })).toBeNull();
    });

    it("creates, replays, edits and archives atomically without account or link side effects", async () => {
      const before = await Promise.all([
        db.user.count(),
        db.householdMemberAccountLink.count(),
        db.householdMemberLegacyMapping.count(),
        db.familyInvite.count({ where: { family_id: A } }),
      ]);
      const created = await createProfile(
        request(
          "parentA",
          "POST",
          { name: "Baby", role: "child", age: 2 },
          CREATE_KEY,
        ),
      );
      expect(created.status).toBe(201);
      const createdBody = await bodyOf(created);
      const profileId = createdBody.profile.id as string;
      expect(createdBody.profile).toMatchObject({
        family_id: A,
        name: "Baby",
        role: "child",
        age: 2,
        revision: 0,
      });

      const replay = await createProfile(
        request(
          "parentA",
          "POST",
          { name: "Baby", role: "child", age: 2 },
          CREATE_KEY,
        ),
      );
      expect(replay.status).toBe(200);
      expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
      expect((await bodyOf(replay)).profile.id).toBe(profileId);

      const changedPayload = await createProfile(
        request(
          "parentA",
          "POST",
          { name: "Different", role: "child", age: 2 },
          CREATE_KEY,
        ),
      );
      expect(changedPayload.status).toBe(422);
      expect((await bodyOf(changedPayload)).error.code).toBe(
        "IDEMPOTENCY_KEY_REUSED",
      );

      const edited = await PATCH(
        request(
          "parentA",
          "PATCH",
          { name: "Older Baby", role: "child", age: 3, revision: 0 },
          EDIT_KEY,
        ),
        routeParams(profileId),
      );
      expect(edited.status).toBe(200);
      expect((await bodyOf(edited)).profile).toMatchObject({
        id: profileId,
        name: "Older Baby",
        age: 3,
        revision: 1,
      });

      const stale = await PATCH(
        request(
          "parentA",
          "PATCH",
          { name: "Stale", revision: 0 },
          "profile-http-stale-01",
        ),
        routeParams(profileId),
      );
      expect(stale.status).toBe(409);
      expect((await bodyOf(stale)).error.code).toBe("PROFILE_CONFLICT");

      const archived = await archiveProfile(
        request("parentA", "POST", { revision: 1 }, ARCHIVE_KEY),
        routeParams(profileId),
      );
      expect(archived.status).toBe(200);
      expect((await bodyOf(archived)).profile.revision).toBe(2);
      expect(
        (await db.householdMember.findUnique({ where: { id: profileId } }))
          ?.archived_at,
      ).not.toBeNull();
      expect(
        await Promise.all([
          db.user.count(),
          db.householdMemberAccountLink.count(),
          db.householdMemberLegacyMapping.count(),
          db.familyInvite.count({ where: { family_id: A } }),
        ]),
      ).toEqual(before);
    });

    it("enforces parent current-session authority and household ownership", async () => {
      const own = await createProfile(
        request(
          "parentA",
          "POST",
          { name: "Own child", age: 4 },
          "profile-http-own-001",
        ),
      );
      const profileId = (await bodyOf(own)).profile.id as string;

      const teen = await createProfile(
        request(
          "teenA",
          "POST",
          { name: "Not allowed" },
          "profile-http-teen-01",
        ),
      );
      expect(teen.status).toBe(403);
      expect(await db.householdMember.count({ where: { family_id: A } })).toBe(
        1,
      );

      await db.user.update({ where: { id: P }, data: { role: "teen" } });
      const demoted = await PATCH(
        request(
          "parentA",
          "PATCH",
          { name: "Demoted", revision: 0 },
          "profile-http-demoted-01",
        ),
        routeParams(profileId),
      );
      expect(demoted.status).toBe(403);
      expect((await bodyOf(demoted)).error.code).toBe("PROFILE_FORBIDDEN");
      await db.user.update({ where: { id: P }, data: { role: "parent" } });

      const foreignEdit = await PATCH(
        request(
          "parentB",
          "PATCH",
          { name: "Foreign edit", revision: 0 },
          "profile-http-foreign-01",
        ),
        routeParams(profileId),
      );
      expect(foreignEdit.status).toBe(404);
      expect((await bodyOf(foreignEdit)).error.code).toBe("PROFILE_NOT_FOUND");
      expect(
        (await db.householdMember.findUnique({ where: { id: profileId } }))
          ?.name,
      ).toBe("Own child");
    });
  },
);
