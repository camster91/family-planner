jest.mock("next/server", () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, body }) },
}));
jest.mock("@/lib/api-auth", () => ({
  authenticateWithFamily: jest.fn(async () => [
    { user: { id: "parent-a", role: "parent", family_id: "family-a" }, payload: { tv: 0 } },
    null,
  ]),
}));
const mockRate = jest.fn(async (..._args: unknown[]) => ({ allowed: true }));
jest.mock("@/lib/rate-limit-db", () => ({ checkRateLimit: (...args: unknown[]) => mockRate(...args) }));
jest.mock("@/lib/routine-schedule-owner", () => ({
  routineScheduleOwner: () => ({ scope: "owner-scope" }),
  routineIndependentOwner: (owner: unknown) => owner,
}));
import { openRoutineSchedule } from "../routine-schedule-http";
import { ROUTINE_SCHEDULE_READY_ENV } from "../routine-schedule-gates";

const request = { headers: new Headers() } as never;
beforeEach(() => {
  mockRate.mockClear();
  process.env[ROUTINE_SCHEDULE_READY_ENV] = "1";
});

// #450: a few ordinary saves made 15-24 context reads each and exhausted the
// shared 120/minute bucket, locking the page with a recovery warning.
it("keeps writes and catalog reads on the shared 120/minute bucket", async () => {
  await openRoutineSchedule(request);
  expect(mockRate).toHaveBeenCalledWith("routine-schedules:parent-a", 120, 60_000);
});

it("gives read-only recovery-context checks a separate bucket", async () => {
  await openRoutineSchedule(request, false, "schedule", true);
  expect(mockRate).toHaveBeenCalledWith("routine-context:parent-a", 900, 60_000);
  expect(mockRate).not.toHaveBeenCalledWith("routine-schedules:parent-a", expect.anything(), expect.anything());
});

it("still refuses a context read when its own bucket is exhausted", async () => {
  mockRate.mockResolvedValueOnce({ allowed: false });
  const opened = await openRoutineSchedule(request, false, "schedule", true);
  expect(opened.ok).toBe(false);
  expect(!opened.ok && opened.response.status).toBe(429);
});
