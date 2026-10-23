/** Authored source; execution belongs to the consolidated QA pass. */
jest.mock("next/server", () => ({
  NextResponse: {
    json: (
      body: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) => ({
      status: init?.status ?? 200,
      headers: new Headers(init?.headers),
      json: async () => body,
    }),
  },
}));
jest.mock("@/lib/review-document-owner", () => ({
  reviewDocumentOwner: jest.fn(),
  reviewDocumentWritingEnabled: jest.fn(),
}));
import type { NextRequest } from "next/server";
import { guardReviewDocumentSubmission } from "../review-document-submit-server";
import {
  reviewDocumentOwner,
  reviewDocumentWritingEnabled,
} from "../review-document-owner";
import { REVIEW_SUBMIT_HEADERS as H } from "../review-document-submit-contract";
import { REVIEW_DOCUMENT_CONTRACT } from "../review-document-contract";
import type { TokenPayload } from "../auth";
const auth = {
  user: { id: "fixture-parent", family_id: "fixture-family", role: "parent" },
  payload: {
    userId: "fixture-parent",
    family_id: "fixture-family",
    role: "parent",
    tv: 0,
  } as TokenPayload,
};
it("refuses account/profile chore submission by a teen before deriving an owner", () => {
  jest.mocked(reviewDocumentOwner).mockClear();
  for (const action of ["chore.create", "chore.profile.create"] as const) {
    const result = guardReviewDocumentSubmission(
      request({ [H.action]: action }),
      {
        ...auth,
        user: { ...auth.user, role: "teen" },
      },
      action,
      true,
    );
    expect(result?.status).toBe(403);
  }
  expect(reviewDocumentOwner).not.toHaveBeenCalled();
});
function request(extra: Record<string, string> = {}) {
  return {
    headers: new Headers({
      [H.contract]: REVIEW_DOCUMENT_CONTRACT,
      [H.owner]: "a".repeat(64),
      [H.action]: "recipe.create",
      [H.expires]: String(Date.now() + 60000),
      "Idempotency-Key": "fixture_recipe_request",
      ...extra,
    }),
  } as NextRequest;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(reviewDocumentOwner).mockReturnValue({
    kind: "person",
    ownerId: auth.user.id,
    generation: 0,
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
  });
  jest.mocked(reviewDocumentWritingEnabled).mockReturnValue(true);
});
it("preserves ordinary legacy requests but refuses partial new-protocol metadata", () => {
  const legacy = { headers: new Headers() } as NextRequest;
  expect(
    guardReviewDocumentSubmission(legacy, auth, "recipe.create"),
  ).toBeNull();
  expect(
    guardReviewDocumentSubmission(legacy, auth, "recipe.create", true)?.status,
  ).toBe(400);
  expect(
    guardReviewDocumentSubmission(
      request({ [H.contract]: "old" }),
      auth,
      "recipe.create",
    )?.status,
  ).toBe(400);
});
it("binds submission to the original current person/domain namespace", () => {
  expect(
    guardReviewDocumentSubmission(request(), auth, "recipe.create", true),
  ).toBeNull();
  expect(
    guardReviewDocumentSubmission(
      request({ [H.owner]: "c".repeat(64) }),
      auth,
      "recipe.create",
      true,
    )?.status,
  ).toBe(409);
  expect(
    guardReviewDocumentSubmission(request(), auth, "event.create", true)
      ?.status,
  ).toBe(400);
  jest.mocked(reviewDocumentOwner).mockReturnValue(null);
  expect(
    guardReviewDocumentSubmission(request(), auth, "recipe.create", true)
      ?.status,
  ).toBe(409);
});
it("refuses paused and expired submissions before canonical dispatch", () => {
  jest.mocked(reviewDocumentWritingEnabled).mockReturnValue(false);
  expect(
    guardReviewDocumentSubmission(request(), auth, "recipe.create", true)
      ?.status,
  ).toBe(503);
  jest.mocked(reviewDocumentWritingEnabled).mockReturnValue(true);
  expect(
    guardReviewDocumentSubmission(
      request({ [H.expires]: "0" }),
      auth,
      "recipe.create",
      true,
    )?.status,
  ).toBe(409);
  expect(
    guardReviewDocumentSubmission(
      request({ [H.expires]: String(Date.now() + 8 * 86400000) }),
      auth,
      "recipe.create",
      true,
    )?.status,
  ).toBe(409);
});
