/** Authored/unrun. HTTP boundaries; atomic DB behavior is covered separately. */
jest.mock("next/server", () => ({
  NextResponse: require("@/__tests__/helpers/two-household").nextServerMock
    .NextResponse,
}));
jest.mock("../../api-auth", () => ({ authenticateWithFamily: jest.fn() }));
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
jest.mock("../persist", () => ({
  ...jest.requireActual("../persist"),
  authorizeFoodWriteInTx: jest.fn(),
  persistReviewedFoodPlan: jest.fn(),
}));
jest.mock("../review", () => ({
  createFoodWriteSourceGuard: jest.fn(() => ({
    verify: jest.fn(),
    assertCurrent: jest.fn(),
  })),
}));
jest.mock("../review-proof", () => ({
  ...jest.requireActual("../review-proof"),
  readFoodReviewSeal: jest.fn(),
}));
jest.mock("../owner", () => ({
  foodRequestOwner: jest.fn(),
  foodWritingEnabled: jest.fn(),
}));
jest.mock("../source-versions", () => ({
  ...jest.requireActual("../source-versions"),
  foodSourceStorageAvailable: jest.fn(async () => true),
}));
jest.mock("../recovery-server", () => ({ inspectFoodRequest: jest.fn() }));
import { NextResponse } from "next/server";
import { authenticateWithFamily } from "../../api-auth";
import { withIdempotency } from "../../idempotency";
import { authorizeFoodWriteInTx, persistReviewedFoodPlan } from "../persist";
import { foodRequestOwner, foodWritingEnabled } from "../owner";
import { inspectFoodRequest } from "../recovery-server";
import { handleFoodHttp } from "../http";
import { FOOD_OWNER_HEADER, FOOD_RECOVERY } from "../recovery-contract";
import {
  actor,
  context,
  makeCommand,
  makeEntry,
  receipt,
} from "./recovery-fixture";
function request(
  body: unknown = makeCommand(),
  extra: Record<string, string> = {},
) {
  return {
    headers: new Headers({
      "Content-Type": "application/json",
      "Idempotency-Key": "food_request_123456789",
      [FOOD_OWNER_HEADER]: context().owner!.scope,
      ...extra,
    }),
    body: null,
    text: async () => JSON.stringify(body),
  } as never;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authenticateWithFamily).mockResolvedValue([
    {
      user: { id: actor.userId, family_id: actor.familyId, role: actor.role },
      payload: {
        userId: actor.userId,
        family_id: actor.familyId,
        role: actor.role,
        tv: 0,
        sid: "fixture-session",
      },
    },
    null,
  ] as never);
  jest
    .mocked(authorizeFoodWriteInTx)
    .mockResolvedValue({ inventoryEnabled: true });
  jest.mocked(foodRequestOwner).mockReturnValue(context().owner!);
  jest.mocked(foodWritingEnabled).mockReturnValue(true);
  jest
    .mocked(persistReviewedFoodPlan)
    .mockResolvedValue({ status: 201, body: receipt() });
  jest
    .mocked(withIdempotency)
    .mockImplementation(async (_db, _key, _ctx, _body, effect) => {
      const result = await effect({ recordId: "root-fixture" });
      return NextResponse.json(result.body, { status: result.status });
    });
});
it("refuses failed person authentication and mismatched ownership before any receipt reservation or effect", async () => {
  jest
    .mocked(authenticateWithFamily)
    .mockResolvedValueOnce([
      null,
      NextResponse.json({ error: "person required" }, { status: 403 }),
    ] as never);
  expect((await handleFoodHttp(request(), "apply")).status).toBe(403);
  expect(withIdempotency).not.toHaveBeenCalled();
  expect(
    (
      await handleFoodHttp(
        request(makeCommand(), { [FOOD_OWNER_HEADER]: "d".repeat(64) }),
        "apply",
      )
    ).status,
  ).toBe(403);
  expect(withIdempotency).not.toHaveBeenCalled();
  expect(persistReviewedFoodPlan).not.toHaveBeenCalled();
});
it("requires an exact bounded request/key and delegates only to the canonical atomic adapter", async () => {
  const response = await handleFoodHttp(request(), "apply");
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(persistReviewedFoodPlan).toHaveBeenCalledWith(
    expect.anything(),
    actor,
    makeCommand(),
    "root-fixture",
    expect.anything(),
  );
  jest.clearAllMocks();
  expect(
    (
      await handleFoodHttp(
        request(makeCommand(), { "content-length": "65537" }),
        "apply",
      )
    ).status,
  ).toBe(413);
  expect(withIdempotency).not.toHaveBeenCalled();
});
it("allows a matching completed receipt during pause without dispatching a source check or mutation", async () => {
  jest.mocked(foodWritingEnabled).mockReturnValue(false);
  jest
    .mocked(withIdempotency)
    .mockImplementation(async (_db, _key, _ctx, _body, _effect, options) => {
      expect(await options!.beforeReplay!()).toBeNull();
      const result = await options!.transformReplay!({
        status: 201,
        body: receipt(),
      });
      return NextResponse.json(result.body, { status: result.status });
    });
  expect((await handleFoodHttp(request(), "apply")).status).toBe(201);
  expect(persistReviewedFoodPlan).not.toHaveBeenCalled();
});
it("keeps unknown transaction outcomes distinct from a failed save", async () => {
  jest
    .mocked(persistReviewedFoodPlan)
    .mockRejectedValueOnce(new Error("synthetic lost commit reply"));
  const response = await handleFoodHttp(request(), "apply");
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: { code: "SAVE_UNCONFIRMED" },
  });
});
it("leaves receipt inspection read-only and retains an owner context when new writes are disabled", async () => {
  jest
    .mocked(authorizeFoodWriteInTx)
    .mockResolvedValue({ inventoryEnabled: false });
  const response = await handleFoodHttp(request(), "context");
  expect(await response.json()).toMatchObject({
    enabled: false,
    owner: context().owner,
  });
  const entry = makeEntry();
  jest.mocked(inspectFoodRequest).mockResolvedValue({
    contract: FOOD_RECOVERY,
    ownerScope: context().owner!.scope,
    entry,
    requestHash: "a".repeat(64),
    state: "pending",
    canRetry: false,
    retryUntil: null,
    receipt: null,
  });
  expect(
    (
      await handleFoodHttp(
        request({ contract: FOOD_RECOVERY, entry }),
        "inspect",
      )
    ).status,
  ).toBe(200);
  expect(withIdempotency).not.toHaveBeenCalled();
  expect(persistReviewedFoodPlan).not.toHaveBeenCalled();
});
