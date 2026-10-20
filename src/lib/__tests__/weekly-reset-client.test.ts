/** Source only: no API was invoked and these cases have not been run. */
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  sendWeeklyReset,
  readWeeklyResetView,
} from "@/lib/weekly-reset-client";
import { WEEKLY_RESET_PROTOCOL } from "@/lib/weekly-reset";
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const request = jest.mocked(requestOwnedJson);
const command = {
  protocol: WEEKLY_RESET_PROTOCOL,
  userId: "user-a",
  familyId: "family-a",
  weekStart: "2026-10-19",
  timeZone: "America/Toronto",
  issuedAt: "2026-10-20T16:00:00Z",
  expectedRevision: 0,
  action: "start",
};
const entry = {
  kind: "weekly-reset" as const,
  key: "weekly_reset_request_a",
  body: JSON.stringify(command),
};
const receipt = {
  protocol: WEEKLY_RESET_PROTOCOL,
  userId: command.userId,
  familyId: command.familyId,
  weekStart: command.weekStart,
  timeZone: command.timeZone,
  action: "start",
  revision: 1,
};
beforeEach(() => request.mockReset());
it.each([
  {},
  { receipt: { ...receipt, userId: "user-b" } },
  { receipt: { ...receipt, familyId: "family-b" } },
  { receipt: { ...receipt, action: "finish" } },
  { receipt: { ...receipt, weekStart: "2026-10-26" } },
])(
  "does not confirm malformed or mismatched acknowledgements %j",
  async (body) => {
    request.mockResolvedValue({
      kind: "reply",
      response: new Response(null, { status: 200 }),
      body,
    });
    expect(await sendWeeklyReset(entry, "a".repeat(64))).toEqual({
      kind: "unknown",
    });
  },
);
it("reuses the exact original body and key and accepts only its bounded receipt", async () => {
  request.mockResolvedValue({
    kind: "reply",
    response: new Response(null, { status: 200 }),
    body: { receipt },
  });
  expect(await sendWeeklyReset(entry, "a".repeat(64))).toEqual({
    kind: "confirmed",
    receipt,
  });
  expect(request).toHaveBeenCalledWith(
    "/api/coordination/weekly-reset",
    expect.objectContaining({
      body: entry.body,
      headers: expect.objectContaining({ "Idempotency-Key": entry.key }),
    }),
    16384,
  );
});
it("does not accept another account's fresh progress snapshot", async () => {
  request.mockResolvedValue({
    kind: "reply",
    response: new Response(null, { status: 200 }),
    body: {
      review: {
        protocol: WEEKLY_RESET_PROTOCOL,
        owner: { userId: "user-b", familyId: command.familyId },
        scope: { weekStart: command.weekStart, timeZone: command.timeZone },
        revision: 1,
        started: false,
        steps: [],
        finishedAt: null,
        complete: false,
      },
    },
  });
  await expect(
    readWeeklyResetView(
      { userId: command.userId, familyId: command.familyId },
      { weekStart: command.weekStart, timeZone: command.timeZone },
    ),
  ).rejects.toThrow("owner changed");
});
