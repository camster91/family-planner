jest.mock(
  "next/server",
  () => require("@/__tests__/helpers/two-household").nextServerMock,
);
jest.mock("@/lib/prisma", () => ({ prisma: null }));
jest.mock("@/lib/storage-backend", () => ({ storageBackend: () => "d1" }));
jest.mock("@/lib/api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("@/lib/cloudflare/schedule-source", () => ({
  authorizeD1ScheduleActor: jest.fn(async () => ({
    role: "parent",
    calendarEnabled: true,
  })),
  validatedD1ScheduleRead: jest.fn((fn) => fn({})),
  d1ScheduleStorageAvailable: jest.fn(async () => true),
  readD1ScheduleSnapshot: jest.fn(),
  previewD1ScheduleQuery: jest.fn(),
}));
jest.mock("@/lib/cloudflare/schedule-write", () => ({
  writeD1ScheduleMove: jest.fn(),
}));
jest.mock("@/lib/cloudflare/schedule-recovery", () => ({
  reviewD1ScheduleRequest: jest.fn(),
}));
jest.mock("../schedule-owner", () => ({
  scheduleReviewReady: jest.fn(() => true),
  scheduleReviewWritingEnabled: jest.fn(() => true),
  scheduleReviewOwner: jest.fn(),
}));
import { handleScheduleHttp } from "../schedule-route";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  readD1ScheduleSnapshot,
  previewD1ScheduleQuery,
} from "@/lib/cloudflare/schedule-source";
import { writeD1ScheduleMove } from "@/lib/cloudflare/schedule-write";
import { reviewD1ScheduleRequest } from "@/lib/cloudflare/schedule-recovery";
import { scheduleReviewOwner } from "../schedule-owner";
import { SCHEDULE_OWNER_HEADER } from "../schedule-recovery";
import {
  actor,
  now,
  context,
  snapshot,
  command,
  query,
  receipt,
  key,
  entry,
} from "./schedule-fixture";
const request = (
  body: unknown = {},
  search = "",
  headers: Record<string, string> = {},
) =>
  ({
    headers: new Headers(headers),
    nextUrl: new URL("https://fixture.test/api?" + search),
    text: async () => JSON.stringify(body),
  }) as never;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authenticateWithFamily).mockResolvedValue([
    {
      user: { id: actor.userId, family_id: actor.familyId, role: "parent" },
      payload: { tv: 0 },
    },
    null,
  ] as never);
  jest.mocked(scheduleReviewOwner).mockReturnValue(context.owner);
  jest
    .mocked(readD1ScheduleSnapshot)
    .mockResolvedValue({ snapshot, evaluatedAt: now.toISOString() });
  jest
    .mocked(previewD1ScheduleQuery)
    .mockResolvedValue({ snapshot, evaluatedAt: now.toISOString() });
  jest
    .mocked(writeD1ScheduleMove)
    .mockResolvedValue({ status: 200, body: receipt, replayed: false });
});
it("serves native context without PostgreSQL", async () => {
  const response = await handleScheduleHttp(request(), "context");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(context);
});
it("dispatches bounded reads and rejects duplicate parameters", async () => {
  const search = new URLSearchParams({
    targetId: "event-a",
    start: snapshot.range.start,
    end: snapshot.range.end,
    timeZone: snapshot.timeZone,
  }).toString();
  expect((await handleScheduleHttp(request({}, search), "read")).status).toBe(
    200,
  );
  expect(readD1ScheduleSnapshot).toHaveBeenCalledWith(actor, {
    targetId: "event-a",
    range: snapshot.range,
    timeZone: snapshot.timeZone,
  });
  expect(
    (await handleScheduleHttp(request({}, search + "&targetId=other"), "read"))
      .status,
  ).toBe(400);
});
it("dispatches native preview", async () => {
  expect((await handleScheduleHttp(request(query), "preview")).status).toBe(
    200,
  );
  expect(previewD1ScheduleQuery).toHaveBeenCalledWith(actor, query);
});
it("requires owner and idempotency before native writes", async () => {
  expect(
    (
      await handleScheduleHttp(
        request(command, "", { "Idempotency-Key": key }),
        "write",
      )
    ).status,
  ).toBe(403);
  expect(writeD1ScheduleMove).not.toHaveBeenCalled();
  const response = await handleScheduleHttp(
    request(command, "", {
      "Idempotency-Key": key,
      [SCHEDULE_OWNER_HEADER]: context.owner!.scope,
    }),
    "write",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(receipt);
  expect(writeD1ScheduleMove).toHaveBeenCalledWith(actor, command, key);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("dispatches owned recovery", async () => {
  jest
    .mocked(reviewD1ScheduleRequest)
    .mockResolvedValue({ state: "committed" } as never);
  const response = await handleScheduleHttp(
    request({ contract: context.contract, entry }, "", {
      [SCHEDULE_OWNER_HEADER]: context.owner!.scope,
    }),
    "inspect",
  );
  expect(response.status).toBe(200);
  expect(reviewD1ScheduleRequest).toHaveBeenCalledWith(
    actor,
    entry,
    context.owner!.scope,
  );
});
