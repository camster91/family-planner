// #417: exercise real exported handlers on the existing two-household harness.
// Timing must survive auth failures as well as reads/login, without recording
// the URL, request payload, credentials or returned household content.
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

import {
  db,
  FAMILY_A,
  FOREIGN,
  req,
  fakePrisma,
} from "@/__tests__/helpers/two-household";
import {
  deviceReq,
  enableSharedDevice,
  disableSharedDevice,
  seedDevice,
  setPassword,
  setCookie,
  resetClock,
  setNow,
} from "@/__tests__/helpers/device";
import { GET as chores } from "@/app/api/chores/route";
import { GET as events } from "@/app/api/events/route";
import { GET as lists } from "@/app/api/lists/route";
import { GET as boardVersion } from "@/app/api/family/board-version/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as deviceToday } from "@/app/api/device/today/route";
import { GET as deviceVersion } from "@/app/api/device/today/version/route";

const routes = [
  ["/api/chores", "GET", chores, "person"],
  ["/api/events", "GET", events, "person"],
  ["/api/lists", "GET", lists, "person"],
  ["/api/family/board-version", "GET", boardVersion, "person"],
  ["/api/auth/login", "POST", login, "login"],
  ["/api/device/today", "GET", deviceToday, "device"],
  ["/api/device/today/version", "GET", deviceVersion, "device"],
] as const;
const requestId = "core-timing-0001";
const sensitive = [
  "private-note",
  "private-cookie",
  "private-body",
  "parent-a@example.test",
  "parent-a-password",
  FAMILY_A,
  FOREIGN,
  "Home dishes",
  "Home dentist",
];

let log: jest.SpyInstance;
const savedLog = process.env.ROUTE_TIMING_LOG;
const savedRate = process.env.ROUTE_TIMING_SAMPLE_RATE;
beforeEach(() => {
  db.reset();
  enableSharedDevice();
  setNow(new Date("2026-10-08T12:00:00Z"));
  setPassword("parentA", "parent-a-password");
  delete process.env.ROUTE_TIMING_LOG;
  delete process.env.ROUTE_TIMING_SAMPLE_RATE;
  log = jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => {
  log.mockRestore();
  if (savedLog === undefined) delete process.env.ROUTE_TIMING_LOG;
  else process.env.ROUTE_TIMING_LOG = savedLog;
  if (savedRate === undefined) delete process.env.ROUTE_TIMING_SAMPLE_RATE;
  else process.env.ROUTE_TIMING_SAMPLE_RATE = savedRate;
  disableSharedDevice();
  resetClock();
});

function makeRequest(
  route: string,
  method: string,
  kind: string,
  authorized: boolean,
) {
  const common = {
    path: route,
    method,
    query: { note: "private-note", familyId: FAMILY_A },
    headers: {
      "x-request-id": requestId,
      cookie: "private-cookie",
      authorization: "private-body",
    },
  };
  if (kind === "device") {
    const d = authorized ? seedDevice("device-d1", FAMILY_A) : undefined;
    return deviceReq({ ...common, cookies: d?.cookies });
  }
  return req({
    ...common,
    as: kind === "person" && authorized ? "parentA" : null,
    body:
      kind === "login" && authorized
        ? { email: "parent-a@example.test", password: "parent-a-password" }
        : undefined,
  });
}

function expectLine(route: string, method: string, status: number) {
  expect(log).toHaveBeenCalledTimes(1);
  const serialized = String(log.mock.calls[0][0]);
  const line = JSON.parse(serialized);
  expect(Object.keys(line).sort()).toEqual([
    "durationMs",
    "event",
    "level",
    "method",
    "release",
    "requestId",
    "route",
    "status",
    "ts",
  ]);
  expect(line).toMatchObject({
    event: "http.request",
    level: "info",
    route,
    method,
    status,
    requestId,
  });
  expect(line.durationMs).toBeGreaterThanOrEqual(0);
  expect(Number.isFinite(line.durationMs)).toBe(true);
  expect(line.release).toMatch(/^(unknown|[a-f0-9]{12})$/);
  expect(Number.isNaN(Date.parse(line.ts))).toBe(false);
  for (const value of sensitive) expect(serialized).not.toContain(value);
  expect(serialized).not.toContain("?");
}

for (const authorized of [false, true]) {
  describe(
    authorized ? "successful core requests" : "refused core requests",
    () => {
      it.each(routes)(
        "%s preserves response/cookies while timing is opt-in",
        async (route, method, handler, kind) => {
          const off = await handler(
            makeRequest(route, method, kind, authorized),
          );
          const expectedStatus = authorized
            ? 200
            : kind === "login"
              ? 400
              : 401;
          expect(off.status).toBe(expectedStatus);
          const offBody = await off.json();
          expect(JSON.stringify(offBody)).not.toContain(FOREIGN);
          expect(log).not.toHaveBeenCalled();

          process.env.ROUTE_TIMING_LOG = "1";
          const on = await handler(
            makeRequest(route, method, kind, authorized),
          );
          expect(on.status).toBe(off.status);
          expect(await on.json()).toEqual(offBody);
          expect(on.headers.get("X-Request-Id")).toBe(requestId);
          for (const name of ["Cache-Control", "Retry-After"])
            expect(on.headers.get(name)).toBe(off.headers.get(name));
          const beforeCookie = setCookie(off, "session_token");
          const afterCookie = setCookie(on, "session_token");
          expect(afterCookie?.options).toEqual(beforeCookie?.options);
          expect(Boolean(afterCookie?.value)).toBe(
            kind === "login" && authorized,
          );
          expectLine(route, method, expectedStatus);
        },
      );
    },
  );
}

it("samples successful reads out at zero but still times sanitized server failures", async () => {
  process.env.ROUTE_TIMING_LOG = "1";
  process.env.ROUTE_TIMING_SAMPLE_RATE = "0";
  expect(
    (await lists(makeRequest("/api/lists", "GET", "person", true))).status,
  ).toBe(200);
  expect(log).not.toHaveBeenCalled();
  const failure = jest
    .spyOn(fakePrisma.list, "findMany")
    .mockRejectedValueOnce(new Error("private-body"));
  const errorLog = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    const response = await lists(
      makeRequest("/api/lists", "GET", "person", true),
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expectLine("/api/lists", "GET", 500);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("private-body");
  } finally {
    failure.mockRestore();
    errorLog.mockRestore();
  }
});
