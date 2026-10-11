/** Route negotiation must preserve legacy readers and refuse a partial profile board. */
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
jest.mock("@/lib/rate-limit-db", () => ({
  checkRateLimit: async () => ({ allowed: true }),
}));
jest.mock("@/lib/recurringChores", () => ({
  topUpHouseholdSeries: jest.fn(async () => undefined),
}));
jest.mock("@/app/dashboard/today/board-snapshot", () => ({
  loadTodayBoard: jest.fn(),
}));

import { FAMILY_A, bodyOf, db, req } from "@/__tests__/helpers/two-household";
import {
  deviceReq,
  enableSharedDevice,
  disableSharedDevice,
  seedDevices,
} from "@/__tests__/helpers/device";
import { loadTodayBoard } from "@/app/dashboard/today/board-snapshot";
import { profileChoreProtocolRefusal } from "@/lib/chore-profile";
import * as personVersion from "../route";
import * as deviceVersion from "@/app/api/device/today/version/route";
import * as deviceToday from "@/app/api/device/today/route";

const load = jest.mocked(loadTodayBoard);
const routes = [deviceToday, deviceVersion];
describe("board member protocol negotiation", () => {
  let fx: ReturnType<typeof seedDevices>;
  beforeEach(() => {
    db.reset();
    enableSharedDevice();
    fx = seedDevices();
    load.mockReset();
    load.mockResolvedValue({
      version: "v1-owned",
      members: [],
      chores: [],
    } as any);
  });
  afterAll(() => disableSharedDevice());

  it.each([undefined, "invalid", "1", "2"])(
    "person version preserves requested protocol %s without changing authority",
    async (header) => {
      const res = await personVersion.GET(
        req({
          as: "childA",
          headers: header ? { "X-Member-Protocol": header } : {},
        }),
      );
      expect(res.status).toBe(200);
      expect(await bodyOf(res)).toEqual({ version: "v1-owned" });
      expect(load).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          familyId: FAMILY_A,
          role: "child",
          memberProtocol: header === "2" ? 2 : 1,
        }),
      );
    },
  );
  it.each(routes)(
    "device board/version uses explicit protocol 2 and its authenticated household",
    async (route) => {
      const res = await route.GET(
        deviceReq({
          cookies: fx.d1.cookies,
          headers: { "X-Member-Protocol": "2" },
        }),
      );
      expect(res.status).toBe(200);
      expect(load).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          familyId: FAMILY_A,
          audience: "device",
          memberProtocol: 2,
        }),
      );
    },
  );
  it.each([personVersion, ...routes])(
    "refuses a profile compatibility error before returning any board/version",
    async (route) => {
      load.mockResolvedValue({
        version: "secret-partial-version",
        members: [{ name: "partial-profile" }],
        protocolError: profileChoreProtocolRefusal(),
      } as any);
      const request =
        route === personVersion
          ? req({ as: "parentA" })
          : deviceReq({ cookies: fx.d1.cookies });
      const res = await route.GET(request);
      expect(res.status).toBe(409);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      const body = await bodyOf(res);
      expect(body.code).toBe("MEMBER_PROTOCOL_UNAVAILABLE");
      expect(JSON.stringify(body)).not.toMatch(
        /partial-profile|secret-partial-version/,
      );
    },
  );
  it("protocol 2 never authenticates an absent person or device", async () => {
    expect(
      (
        await personVersion.GET(
          req({ as: null, headers: { "X-Member-Protocol": "2" } }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await deviceToday.GET(
          deviceReq({ headers: { "X-Member-Protocol": "2" } }),
        )
      ).status,
    ).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });
});
