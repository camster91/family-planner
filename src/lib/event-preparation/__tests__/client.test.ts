/** @jest-environment node */
/** Authored/unrun; only fabricated responses and exact-request source cases. */
import { webcrypto } from "node:crypto";
import { requestOwnedJson } from "@/lib/owned-request-http";
import {
  hashIdempotentRequest,
  IDEMPOTENCY_MAX_BODY_CHARS,
} from "@/lib/idempotency";
import { PREPARATION_ACTION, preparationReceipt } from "../http";
import { preparationRequestHash } from "../request-hash";
import {
  makePreparationIntent,
  sendPreparation,
  inspectPreparation,
} from "../client";
import {
  preparationRecoveryReview,
  PREPARATION_REQUEST_BYTES,
} from "../recovery";
import { preparationViewSchema } from "../view-contract";
import { preparationRecoveryFixture } from "./recovery-fixture";
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const request = jest.mocked(requestOwnedJson);
const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
beforeAll(() =>
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  }),
);
afterAll(() => {
  if (cryptoDescriptor)
    Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
  else Reflect.deleteProperty(globalThis, "crypto");
});
beforeEach(() => jest.clearAllMocks());
const reply = (body: unknown) => ({
  kind: "reply" as const,
  body,
  response: { ok: true, status: 200 } as Response,
});
it("uses the server's canonical request digest and preserves exact body/key across uncertain retry", async () => {
  const f = preparationRecoveryFixture();
  expect(await preparationRequestHash(f.command)).toBe(
    hashIdempotentRequest(PREPARATION_ACTION, f.command),
  );
  const intent = await makePreparationIntent(
    f.preview,
    f.command,
    f.recovery,
    f.entry.key,
  );
  expect(intent).toEqual(f.entry);
  request
    .mockResolvedValueOnce({ kind: "unknown" })
    .mockResolvedValueOnce(reply(f.receipt));
  expect(await sendPreparation(intent, f.recovery.owner!.scope)).toEqual({
    kind: "unknown",
  });
  expect((await sendPreparation(intent, f.recovery.owner!.scope)).kind).toBe(
    "confirmed",
  );
  for (const call of request.mock.calls)
    expect(call[1]).toMatchObject({
      body: intent.body,
      headers: { "Idempotency-Key": intent.key },
    });
});
it("rejects changed preview/effect/owner and tampered saved digest before any network send", async () => {
  const f = preparationRecoveryFixture();
  await expect(
    makePreparationIntent(
      {
        ...f.preview,
        effects: { ...f.preview.effects!, detach: ["unreviewed-task"] },
      },
      f.command,
      f.recovery,
      f.entry.key,
    ),
  ).rejects.toThrow();
  await expect(
    makePreparationIntent(
      f.preview,
      f.command,
      { ...f.recovery, enabled: false },
      f.entry.key,
    ),
  ).rejects.toThrow();
  await expect(
    sendPreparation(
      { ...f.entry, requestHash: "f".repeat(64) },
      f.recovery.owner!.scope,
    ),
  ).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it("holds generic success, wrong digest, extra private DTO and malformed recovered body", async () => {
  const f = preparationRecoveryFixture();
  for (const body of [
    { success: true },
    { ...f.receipt, task: { description: "PRIVATE" } },
    { receipt: { ...f.receipt.receipt, requestHash: "f".repeat(64) } },
  ]) {
    request.mockResolvedValueOnce(reply(body));
    expect(await sendPreparation(f.entry, f.recovery.owner!.scope)).toEqual({
      kind: "unknown",
    });
  }
  const review = {
    contract: f.recovery.contract,
    ownerScope: f.recovery.owner!.scope,
    entry: f.entry,
    state: "committed",
    canRetry: false,
    currentToken: null,
    receipt: f.receipt,
  };
  request.mockResolvedValueOnce(reply(review));
  expect((await inspectPreparation(f.entry, f.recovery)).state).toBe(
    "committed",
  );
  expect(
    preparationRecoveryReview.safeParse({
      ...review,
      entry: { ...f.entry, body: "{" },
    }).success,
  ).toBe(false);
  expect(
    preparationViewSchema.safeParse({
      ...f.preview.view,
      tasks: [{ id: "unknown-a", available: false, description: "PRIVATE" }],
    }).success,
  ).toBe(false);
});
it("supports 99 full escaped-content steps while keeping proof below the generic receipt limit", async () => {
  const f = preparationRecoveryFixture();
  const step = f.command.steps[0];
  if (step.kind !== "new") throw new Error("fixture");
  f.command.steps = Array.from({ length: 99 }, (_, index) => ({
    ...step,
    clientId: `step-${index}`,
    title: "\u0000".repeat(200),
    description: "\u0000".repeat(1000),
  }));
  const body = JSON.stringify(f.command);
  expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(
    PREPARATION_REQUEST_BYTES,
  );
  const receipt = preparationReceipt.parse({
    receipt: {
      ...f.receipt.receipt,
      requestHash: hashIdempotentRequest(PREPARATION_ACTION, f.command),
      createdCount: 99,
    },
  });
  expect(JSON.stringify(receipt).length).toBeLessThan(
    IDEMPOTENCY_MAX_BODY_CHARS,
  );
});
