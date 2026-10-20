/** Authored only. No app/API/browser request has run. */
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  sendSchedule,
  inspectSchedule,
  makeScheduleIntent,
  readScheduleSnapshot,
} from "../schedule-client";
import { scheduleRecoveryReview } from "../schedule-recovery";
import {
  snapshot,
  query,
  choice,
  entry,
  receipt,
  context,
  now,
} from "./schedule-fixture";
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const request = jest.mocked(requestOwnedJson);
const reply = (body: unknown, ok = true, status = 200) => ({
  kind: "reply" as const,
  body,
  response: { ok, status } as Response,
});
beforeEach(() => jest.resetAllMocks());
it("freezes an applicable exact preview using its server evaluation time and keeps the original body/key on retries", async () => {
  const saved = makeScheduleIntent(
    { snapshot, evaluatedAt: now.toISOString() },
    query,
    choice,
    context,
    entry.key,
  );
  expect(saved).toEqual(entry);
  request
    .mockResolvedValueOnce({ kind: "unknown" })
    .mockResolvedValueOnce(reply(receipt));
  expect(await sendSchedule(saved, context.owner!.scope)).toEqual({
    kind: "unknown",
  });
  expect((await sendSchedule(saved, context.owner!.scope)).kind).toBe(
    "confirmed",
  );
  for (const call of request.mock.calls)
    expect(call[1]).toMatchObject({
      body: entry.body,
      headers: {
        "Idempotency-Key": entry.key,
        "X-Herewoven-Schedule-Owner": context.owner!.scope,
      },
    });
});
it("never confirms generic success, changed proof, extra private DTOs or malformed acknowledgements", async () => {
  for (const body of [
    { success: true },
    { ...receipt, event: { title: "PRIVATE" } },
    { receipt: { ...receipt.receipt, targetId: "other-event" } },
    { receipt: { ...receipt.receipt, end: receipt.receipt.start } },
  ]) {
    request.mockResolvedValueOnce(reply(body));
    expect(await sendSchedule(entry, context.owner!.scope)).toEqual({
      kind: "unknown",
    });
  }
  request.mockResolvedValueOnce(reply({ error: "refused" }, false, 403));
  expect(await sendSchedule(entry, context.owner!.scope)).toEqual({
    kind: "refused",
  });
});
it("refuses another owner/scope and a paused client before staging an intent", async () => {
  expect(() =>
    makeScheduleIntent(
      {
        snapshot: {
          ...snapshot,
          owner: { ...snapshot.owner, userId: "other-user" },
        },
        evaluatedAt: now.toISOString(),
      },
      query,
      choice,
      context,
      entry.key,
    ),
  ).toThrow();
  expect(() =>
    makeScheduleIntent(
      { snapshot, evaluatedAt: now.toISOString() },
      query,
      choice,
      { ...context, enabled: false },
      entry.key,
    ),
  ).toThrow();
  expect(request).not.toHaveBeenCalled();
  request.mockResolvedValueOnce(
    reply({
      snapshot: {
        ...snapshot,
        range: { ...snapshot.range, end: "2026-10-27T00:00:00Z" },
      },
      evaluatedAt: now.toISOString(),
    }),
  );
  await expect(
    readScheduleSnapshot(
      {
        targetId: query.target.id,
        range: query.range,
        timeZone: query.timeZone,
      },
      context,
    ),
  ).rejects.toThrow("scope changed");
});
it("binds inspected proof to the exact saved request and current owner, and rejects malformed saved-body contracts without throwing out of safeParse", async () => {
  const review = {
    contract: context.contract,
    ownerScope: context.owner!.scope,
    entry,
    state: "committed" as const,
    canRetry: false,
    currentSnapshotToken: null,
    receipt,
  };
  request.mockResolvedValueOnce(reply(review));
  expect((await inspectSchedule(entry, context)).state).toBe("committed");
  request.mockResolvedValueOnce(
    reply({ ...review, entry: { ...entry, key: "different_schedule_key" } }),
  );
  await expect(inspectSchedule(entry, context)).rejects.toThrow();
  expect(
    scheduleRecoveryReview.safeParse({
      ...review,
      entry: { ...entry, body: "not json" },
    }).success,
  ).toBe(false);
});
