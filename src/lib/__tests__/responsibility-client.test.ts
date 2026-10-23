/** Source-only recovery contract tests. No HTTP requests or providers run here. */
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  sendResponsibility,
  readResponsibility,
  makeResponsibilityIntent,
} from "@/lib/responsibility-client";
import { RESPONSIBILITY_PROTOCOL } from "@/lib/responsibility";
import {
  responsibilityRecoveryReview,
  RESPONSIBILITY_RECOVERY,
} from "@/lib/responsibility-recovery";
import type { ResponsibilityView } from "@/lib/responsibility-http-contract";
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const request = jest.mocked(requestOwnedJson);
const context = {
  contract: RESPONSIBILITY_RECOVERY,
  enabled: true,
  owner: {
    kind: "person" as const,
    ownerId: "parent-a",
    scope: "a".repeat(64),
    generation: 0,
    householdScope: "b".repeat(64),
  },
  userId: "parent-a",
  familyId: "family-a",
  role: "parent" as const,
} as const;
const target = { kind: "chore" as const, id: "chore-a" },
  key = "responsibility_request_a";
const view: ResponsibilityView = {
  protocol: RESPONSIBILITY_PROTOCOL,
  owner: { userId: context.userId, familyId: context.familyId },
  target,
  title: "Bins",
  href: "/dashboard/chores",
  sourceToken: "c".repeat(64),
  revision: 2,
  active: true,
  writesEnabled: true,
  role: "parent",
  primary: {
    member: {
      subject: { kind: "account", accountId: context.userId },
      name: "Parent",
    },
    statement: null,
  },
  backup: null,
  sourceChanged: false,
  choices: [],
  moreChoices: false,
};
const entry = makeResponsibilityIntent(
  {
    action: "state-intent",
    slot: "primary",
    decision: "accepted",
    method: "self",
  },
  view,
  context,
  new Date("2026-10-20T16:00:00Z"),
  key,
);
const receipt = {
  receipt: {
    protocol: RESPONSIBILITY_PROTOCOL,
    userId: context.userId,
    familyId: context.familyId,
    target,
    requestKey: key,
    action: "state-intent",
    sourceToken: view.sourceToken,
    revision: 3,
  },
};
beforeEach(() => request.mockReset());
it.each([
  {},
  { receipt: { ...receipt.receipt, requestKey: "different_request_a" } },
  { receipt: { ...receipt.receipt, userId: "someone-else" } },
  { receipt: { ...receipt.receipt, target: { kind: "chore", id: "another" } } },
  { receipt: { ...receipt.receipt, sourceToken: "f".repeat(64) } },
  { receipt: { ...receipt.receipt, revision: 10 } },
])("keeps malformed/mismatched acknowledgements unknown %j", async (body) => {
  request.mockResolvedValue({
    kind: "reply",
    response: new Response(null, { status: 200 }),
    body,
  });
  expect(await sendResponsibility(entry, context.owner.scope)).toEqual({
    kind: "unknown",
  });
});
it("sends only the frozen body/key and confirms its exact scoped receipt", async () => {
  request.mockResolvedValue({
    kind: "reply",
    response: new Response(null, { status: 200 }),
    body: receipt,
  });
  expect(await sendResponsibility(entry, context.owner.scope)).toEqual({
    kind: "confirmed",
    receipt,
  });
  expect(request).toHaveBeenCalledWith(
    "/api/coordination/responsibilities",
    expect.objectContaining({
      body: entry.body,
      headers: expect.objectContaining({ "Idempotency-Key": key }),
    }),
    16384,
  );
});
it("does not reuse a view after account/household/role context changes", async () => {
  expect(() =>
    makeResponsibilityIntent(
      { action: "clear-statement", slot: "primary" },
      view,
      { ...context, role: "teen" },
    ),
  ).toThrow("owner changed");
  request.mockResolvedValue({
    kind: "reply",
    response: new Response(null, { status: 200 }),
    body: {
      view: {
        ...view,
        owner: { userId: "parent-b", familyId: context.familyId },
      },
    },
  });
  await expect(readResponsibility(target, context)).rejects.toThrow(
    "owner changed",
  );
});
it("cannot label an unavailable/null receipt as committed or allow a retry without a current revision", () => {
  const base = {
    contract: RESPONSIBILITY_RECOVERY,
    ownerScope: context.owner.scope,
    entry,
    state: "committed",
    canRetry: false,
    currentRevision: null,
    receipt: null,
  };
  expect(responsibilityRecoveryReview.safeParse(base).success).toBe(false);
  expect(
    responsibilityRecoveryReview.safeParse({
      ...base,
      state: "ready",
      canRetry: true,
    }).success,
  ).toBe(false);
  expect(
    responsibilityRecoveryReview.safeParse({ ...base, receipt }).success,
  ).toBe(true);
  expect(
    responsibilityRecoveryReview.safeParse({
      ...base,
      entry: { ...entry, body: "{" },
    }).success,
  ).toBe(false);
});
