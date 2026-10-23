import { reviewDocumentContext } from "@/lib/review-document-contract";

/** Explicit pre-adoption household for legacy form/request tests. Adopted
 * persistence and owner-change behavior is covered by recipe-owned-draft tests.
 * Unexpected storage use must fail rather than silently supplying a journal. */
export function legacyRecipeReviewMock() {
  return {
    readReviewDocumentContext: jest.fn(async (domain: string) => {
      if (domain !== "recipe") throw new Error("Unexpected fixture domain");
      return reviewDocumentContext.parse({
        contract: "herewoven.review-document.v1",
        userId: "fixture-parent",
        familyId: "fixture-family",
        domain,
        role: "parent",
        enabled: false,
        adopted: false,
        owner: null,
      });
    }),
    browserReviewDocument: jest.fn(() => {
      throw new Error("Unadopted fixture must not open recovery storage");
    }),
  };
}
