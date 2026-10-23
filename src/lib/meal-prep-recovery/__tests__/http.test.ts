/** Authored/unrun. Person/header/key/local-draft HTTP boundaries. */
jest.mock("next/server", () => ({
  NextResponse: require("@/__tests__/helpers/two-household").nextServerMock
    .NextResponse,
}));
jest.mock("../../api-auth", () => ({ authenticateWithFamily: jest.fn() }));
jest.mock("../../device-route", () => ({
  refusePairedDevice: jest.fn(async () => null),
}));
jest.mock("../../prisma", () => ({
  prisma: {
    $transaction: jest.fn(async (run: (tx: object) => unknown) => run({})),
  },
}));
jest.mock("../../rate-limit-db", () => ({
  checkRateLimit: jest.fn(async () => ({ allowed: true })),
}));
jest.mock("../../idempotency", () => ({
  ...jest.requireActual("../../idempotency"),
  withIdempotency: jest.fn(),
}));
jest.mock("../owner", () => ({
  prepRecoveryEnabled: jest.fn(() => true),
  prepRequestOwner: jest.fn(),
}));
jest.mock("../server", () => ({
  ...jest.requireActual("../server"),
  authorizePrepRecovery: jest.fn(),
  inspectOwnedPrep: jest.fn(),
  persistOwnedPrep: jest.fn(),
}));
import { authenticateWithFamily } from "../../api-auth";
import { withIdempotency } from "../../idempotency";
import { prepRequestOwner } from "../owner";
import { authorizePrepRecovery, inspectOwnedPrep } from "../server";
import { handlePrepRecoveryHttp } from "../http";
import { PREP_RECOVERY, PREP_OWNER_HEADER } from "../contract";
import { actor, command, context, entry } from "./fixture";
const request = (body: unknown, headers: Record<string, string> = {}) =>
  ({
    headers: new Headers({
      "Content-Type": "application/json",
      "Idempotency-Key": entry().key,
      [PREP_OWNER_HEADER]: context().owner!.scope,
      ...headers,
    }),
    body: null,
    text: async () => JSON.stringify(body),
  }) as never;
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authorizePrepRecovery).mockResolvedValue(undefined);
  jest.mocked(prepRequestOwner).mockReturnValue(context().owner);
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValue([
      {
        user: { id: actor.userId, family_id: actor.familyId, role: actor.role },
        payload: {
          userId: actor.userId,
          family_id: actor.familyId,
          role: actor.role,
          tv: actor.generation,
        },
      } as never,
      null,
    ]);
});
it("refuses another owner header before private inspection or reservation", async () => {
  const result = await handlePrepRecoveryHttp(
    request(
      { contract: PREP_RECOVERY, entry: entry() },
      { [PREP_OWNER_HEADER]: "other-owner" },
    ),
    "inspect",
  );
  expect(result.status).toBe(403);
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(inspectOwnedPrep).not.toHaveBeenCalled();
  expect(withIdempotency).not.toHaveBeenCalled();
});
it("requires the identical original key and will not dispatch a local-only document", async () => {
  const result = await handlePrepRecoveryHttp(
    request(
      { contract: PREP_RECOVERY, entry: entry() },
      { "Idempotency-Key": "different_request_key_1234" },
    ),
    "apply",
  );
  expect(result.status).toBe(400);
  const local = {
    ...entry(),
    kind: "local-prep-draft",
    body: JSON.stringify({ draft: {} }),
  };
  expect(
    (
      await handlePrepRecoveryHttp(
        request({ contract: PREP_RECOVERY, entry: local }),
        "apply",
      )
    ).status,
  ).toBe(400);
  expect(withIdempotency).not.toHaveBeenCalled();
});
it("renews command-bound authority before the idempotency boundary", async () => {
  const { NextResponse } = jest.requireMock("next/server");
  jest
    .mocked(withIdempotency)
    .mockResolvedValueOnce(
      NextResponse.json(
        { batchId: "batch-a", mealIds: ["meal-a"] },
        { status: 201 },
      ),
    );
  const result = await handlePrepRecoveryHttp(
    request({ contract: PREP_RECOVERY, entry: entry() }),
    "apply",
  );
  expect(result.status).toBe(201);
  expect(authorizePrepRecovery).toHaveBeenCalledWith({}, actor, command());
  expect(withIdempotency).toHaveBeenCalledWith(
    expect.anything(),
    entry().key,
    expect.objectContaining({
      scope: `user:${actor.userId}`,
      familyId: actor.familyId,
      userId: actor.userId,
      action: "meal-prep.allocate",
    }),
    command(),
    expect.any(Function),
    expect.objectContaining({
      beforeReplay: expect.any(Function),
      transformReplay: expect.any(Function),
    }),
  );
});
