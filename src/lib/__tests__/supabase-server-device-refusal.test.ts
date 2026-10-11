jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock(
  "@/lib/session",
  () => require("@/__tests__/helpers/two-household").sessionMock,
);
jest.mock("@/lib/prisma", () => ({
  prisma: require("@/__tests__/helpers/two-household").fakePrisma,
}));
jest.mock("next/headers", () => {
  const values: Record<string, string | undefined> = {};
  return {
    cookies: async () => ({
      get: (name: string) =>
        values[name] ? { value: values[name] } : undefined,
    }),
    setCookieValues: (next: Record<string, string | undefined>) => {
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, next);
    },
  };
});

import { getServerUser } from "@/lib/supabase/server";
import {
  db,
  enableSharedDevice,
  seedDevices,
  disableSharedDevice,
  setNow,
  resetClock,
} from "@/__tests__/helpers/device";

const headersMock = require("next/headers") as {
  setCookieValues: (values: Record<string, string | undefined>) => void;
};

beforeEach(() => {
  db.reset();
  enableSharedDevice();
  setNow(new Date("2026-10-11T12:00:00.000Z"));
  headersMock.setCookieValues({});
});

afterEach(() => {
  disableSharedDevice();
  resetClock();
});

describe("getServerUser shared-device boundary (#510)", () => {
  it("does not authorize a live paired device even when a valid person session remains", async () => {
    const fx = seedDevices();
    headersMock.setCookieValues({
      fp_device: fx.d1.access,
      fp_device_refresh: fx.d1.refresh,
      session_token: "session:parent-a",
    });

    await expect(getServerUser()).resolves.toBeNull();
    expect(db.writes).toEqual([]);
  });

  it.each(["revoked", "expired", "switch-off"] as const)(
    "keeps a clean person session working when the paired credential is %s",
    async (state) => {
      const fx = seedDevices();
      if (state === "revoked") {
        db.find("householdDevice", fx.d1.deviceId)!.revoked_at = new Date();
      } else if (state === "expired") {
        const session = db.find("deviceSession", fx.d1.sessionId)!;
        session.access_expires_at = new Date("2026-10-11T11:59:00.000Z");
        session.refresh_expires_at = new Date("2026-10-11T11:59:00.000Z");
      } else {
        disableSharedDevice();
      }
      headersMock.setCookieValues({
        fp_device: fx.d1.access,
        fp_device_refresh: fx.d1.refresh,
        session_token: "session:parent-a",
      });

      await expect(getServerUser()).resolves.toMatchObject({
        id: "parent-a",
        family_id: "family-A",
      });
    },
  );
});
