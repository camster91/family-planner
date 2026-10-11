// Real-Postgres API checks for #510: a live paired-device credential must not
// turn a stale person cookie into access to private APIs. This deliberately
// calls the route handlers with real NextRequest objects and a real Prisma
// client; the test is opt-in and uses only its disposable synthetic household.
//
// RUN_DB_INTEGRATION=1 DATABASE_URL=... against a database prepared with
// `node scripts/migrate.js`. No provider, browser, or production data is used.

import { NextRequest } from "next/server";
import { signToken } from "@/lib/auth";
import { assertFixtureTargetAllowed } from "@/lib/fixtures/guard";

const describeWithDatabase =
  process.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

jest.setTimeout(60_000);

describeWithDatabase(
  "paired-device person-auth boundary against Postgres",
  () => {
    let prisma: NonNullable<typeof import("@/lib/prisma").prisma>;
    let createDeviceSession: typeof import("@/lib/device-session").createDeviceSession;
    let familyEvents: typeof import("../events/route");
    let familyFeatures: typeof import("../family/features/route");
    let familyMembers: typeof import("../family/members/route");
    let deviceMe: typeof import("../device/me/route");
    let logout: typeof import("../auth/logout/route");

    const FAMILY = "pdauth-int-family";
    const PARENT = "pdauth-int-parent";
    const DEVICE = "pdauth-int-device";
    const SESSION = "pdauth-int-device-session";
    const MESSAGE = "pdauth-int-private-message";
    const PRIVATE_CANARY = "PDAUTH-PRIVATE-CANARY";
    const PARENT_EMAIL = "parent@pdauth-int.test";
    const LABEL = "#510 synthetic tablet";
    const priorSharedDeviceEnabled = process.env.SHARED_DEVICE_ENABLED;

    let accessToken = "";
    let refreshToken = "";
    let sessionToken = "";

    type RequestOptions = {
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      session?: boolean;
      device?: boolean;
      body?: unknown;
    };

    function request(path: string, options: RequestOptions = {}): NextRequest {
      const cookies: string[] = [];
      if (options.session !== false)
        cookies.push(`session_token=${sessionToken}`);
      if (options.device !== false) {
        cookies.push(`fp_device=${accessToken}`);
        cookies.push(`fp_device_refresh=${refreshToken}`);
      }
      const headers = new Headers({ cookie: cookies.join("; ") });
      if (options.body !== undefined) {
        headers.set("content-type", "application/json");
      }
      return new NextRequest(`http://localhost${path}`, {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    }

    async function errorCode(response: Response): Promise<string | undefined> {
      const body = (await response.json()) as { error?: { code?: string } };
      return body.error?.code;
    }

    async function removeSyntheticRows() {
      if (!prisma) return;
      // Family deletion cascades the synthetic device, sessions, message and
      // any route-owned rows. The explicit device delete also makes cleanup safe
      // if a migration under test temporarily changes a relation action.
      await prisma.deviceSession.deleteMany({ where: { id: SESSION } });
      await prisma.householdDevice.deleteMany({ where: { id: DEVICE } });
      await prisma.message.deleteMany({ where: { id: MESSAGE } });
      await prisma.event.deleteMany({ where: { family_id: FAMILY } });
      await prisma.family.deleteMany({ where: { id: FAMILY } });
      await prisma.user.deleteMany({ where: { id: PARENT } });
    }

    async function seedSyntheticRows() {
      await removeSyntheticRows();
      await prisma.family.create({
        data: {
          id: FAMILY,
          name: "#510 synthetic family",
          invite_code: "pdauth-int-invite",
        },
      });
      await prisma.user.create({
        data: {
          id: PARENT,
          email: PARENT_EMAIL,
          name: "#510 synthetic parent",
          role: "parent",
          family_id: FAMILY,
        },
      });
      await prisma.message.create({
        data: {
          id: MESSAGE,
          family_id: FAMILY,
          sender_id: PARENT,
          content: PRIVATE_CANARY,
        },
      });
      const device = await prisma.householdDevice.create({
        data: {
          id: DEVICE,
          family_id: FAMILY,
          label: LABEL,
          platform: "web",
          created_by: PARENT,
          confirmed_by: PARENT,
        },
      });
      const issued = await createDeviceSession(
        prisma,
        device.id,
        FAMILY,
        new Date(),
      );
      // The route only needs the plaintext values in this test process. The
      // database stores only the hashes, as the production pairing flow does.
      accessToken = issued.accessToken;
      refreshToken = issued.refreshToken;
      sessionToken = signToken({
        userId: PARENT,
        email: PARENT_EMAIL,
        role: "parent",
        family_id: FAMILY,
        tv: 0,
      });
    }

    async function expectDeviceRefusal(response: Response) {
      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("DEVICE_WRITE_NOT_ALLOWED");
      expect(response.headers.get("Cache-Control")).toContain(
        "private, no-store",
      );
    }

    beforeAll(async () => {
      // Fail closed before importing the Prisma singleton or opening a database
      // connection. RUN_DB_INTEGRATION is never enough to authorize a target.
      assertFixtureTargetAllowed(process.env);
      process.env.SHARED_DEVICE_ENABLED = "1";
      const mod = await import("@/lib/prisma");
      if (!mod.prisma)
        throw new Error("Integration database is not configured");
      prisma = mod.prisma;
      ({ createDeviceSession } = await import("@/lib/device-session"));
      familyEvents = await import("../events/route");
      familyFeatures = await import("../family/features/route");
      familyMembers = await import("../family/members/route");
      deviceMe = await import("../device/me/route");
      logout = await import("../auth/logout/route");
      await seedSyntheticRows();
    });

    beforeEach(async () => {
      await seedSyntheticRows();
    });

    afterAll(async () => {
      try {
        await removeSyntheticRows();
      } finally {
        if (priorSharedDeviceEnabled === undefined) {
          delete process.env.SHARED_DEVICE_ENABLED;
        } else {
          process.env.SHARED_DEVICE_ENABLED = priorSharedDeviceEnabled;
        }
        await prisma?.$disconnect();
      }
    });

    it("refuses common-auth and direct-server-user reads before private data is loaded", async () => {
      await expectDeviceRefusal(await familyEvents.GET(request("/api/events")));
      await expectDeviceRefusal(
        await familyFeatures.GET(request("/api/family/features")),
      );
      await expectDeviceRefusal(
        await familyMembers.GET(request("/api/family/members")),
      );

      const events = await prisma.event.count({ where: { family_id: FAMILY } });
      expect(events).toBe(0);
    });

    it("refuses a private write before validation and leaves the household unchanged", async () => {
      const before = await prisma.event.count({ where: { family_id: FAMILY } });
      const response = await familyEvents.POST(
        request("/api/events", {
          method: "POST",
          body: {
            title: PRIVATE_CANARY,
            start_time: "2026-10-11T15:00:00.000Z",
            end_time: "2026-10-11T16:00:00.000Z",
            event_type: "other",
          },
        }),
      );
      await expectDeviceRefusal(response);
      expect(await prisma.event.count({ where: { family_id: FAMILY } })).toBe(
        before,
      );
      expect(
        await prisma.message.findUnique({ where: { id: MESSAGE } }),
      ).toMatchObject({ content: PRIVATE_CANARY });
    });

    it("keeps device DTO access and public logout available with or without a person session", async () => {
      const dto = await deviceMe.GET(
        request("/api/device/me", { session: false }),
      );
      expect(dto.status).toBe(200);
      const text = JSON.stringify(await dto.json());
      expect(text).toContain(LABEL);
      expect(text).not.toContain(PRIVATE_CANARY);
      expect(text).not.toContain(PARENT_EMAIL);
      expect(text).not.toContain('"family_id"');

      // A paired browser can retain a stale person cookie. Logout remains a
      // deliberate auth-state write so that the person session can be cleared;
      // it must not be blocked by the device refusal boundary.
      const signedOut = await logout.POST(request("/api/auth/logout"));
      expect(signedOut.status).toBe(200);
      expect(await signedOut.json()).toEqual({ success: true });
      expect(signedOut.headers.get("set-cookie")).toContain("session_token=");
      expect(
        (
          await prisma.user.findUnique({
            where: { id: PARENT },
            select: { token_version: true },
          })
        )?.token_version,
      ).toBe(1);

      // Logout must not consume or revoke the independent paired-device session.
      expect(
        (await deviceMe.GET(request("/api/device/me", { session: false })))
          .status,
      ).toBe(200);
    });

    it("allows a clean person session while preserving device-only separation", async () => {
      const person = await familyEvents.GET(
        request("/api/events", { device: false }),
      );
      expect(person.status).toBe(200);
      expect(await person.json()).toMatchObject({ events: [] });

      const deviceOnly = await familyEvents.GET(
        request("/api/events", { session: false }),
      );
      await expectDeviceRefusal(deviceOnly);
    });

    it("does not refuse a revoked or fully expired device, but still refuses a live refresh session", async () => {
      await prisma.deviceSession.update({
        where: { id: SESSION },
        data: { access_expires_at: new Date(Date.now() - 1_000) },
      });
      await expectDeviceRefusal(await familyEvents.GET(request("/api/events")));

      await prisma.deviceSession.update({
        where: { id: SESSION },
        data: { refresh_expires_at: new Date(Date.now() - 1_000) },
      });
      expect((await familyEvents.GET(request("/api/events"))).status).toBe(200);

      await prisma.deviceSession.update({
        where: { id: SESSION },
        data: {
          access_expires_at: new Date(Date.now() + 60 * 60 * 1_000),
          refresh_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        },
      });
      await prisma.householdDevice.update({
        where: { id: DEVICE },
        data: { revoked_at: new Date() },
      });
      expect((await familyEvents.GET(request("/api/events"))).status).toBe(200);
    });

    it("honours the shared-device kill switch for both person and device routes", async () => {
      process.env.SHARED_DEVICE_ENABLED = "0";
      const person = await familyEvents.GET(request("/api/events"));
      expect(person.status).toBe(200);
      expect(await person.json()).toMatchObject({ events: [] });

      const device = await deviceMe.GET(
        request("/api/device/me", { session: false }),
      );
      expect(device.status).toBe(404);
    });
  },
);
