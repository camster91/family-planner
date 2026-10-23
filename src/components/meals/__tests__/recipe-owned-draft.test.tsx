/** @jest-environment jsdom */
/** Authored only. These UI cases have not been run. */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("@/components/layout/pending-form-navigation", () => ({
  usePendingFormNavigationController: () => ({
    releaseBeforeNavigation: async () => true,
  }),
}));
jest.mock("@/components/chores/useRoutineLinkNavigation", () => ({
  useRoutineLinkNavigation: jest.fn(),
}));
jest.mock("@/lib/review-document-browser", () => ({
  readReviewDocumentContext: jest.fn(),
  browserReviewDocument: jest.fn(),
}));
jest.mock("@/lib/review-document-receipts", () => ({
  inspectReviewDocumentReceipt: jest.fn(),
}));
jest.mock("@/lib/review-document-submit", () => ({
  submitReviewDocumentRequest: jest.fn(),
}));
import { RecipeEditor } from "../RecipeEditor";
import {
  readReviewDocumentContext,
  browserReviewDocument,
} from "@/lib/review-document-browser";
import {
  reviewDocumentContext,
  reviewDocumentPayload,
  REVIEW_DOCUMENT_CONTRACT,
  type ReviewDocumentEntry,
  type RecipeEditableDocument,
} from "@/lib/review-document-contract";
import { newReviewDocument } from "@/lib/review-document-store";
const context = reviewDocumentContext.parse({
  contract: REVIEW_DOCUMENT_CONTRACT,
  userId: "fixture-parent",
  familyId: "fixture-family",
  domain: "recipe",
  enabled: true,
  adopted: true,
  role: "parent",
  owner: {
    kind: "person",
    ownerId: "fixture-parent",
    generation: 0,
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
  },
});
const draft: RecipeEditableDocument = {
  domain: "recipe",
  title: "Original soup",
  description: "Keep all text",
  instructions: "Mix\n\nSimmer.",
  servings: "",
  prep: "1.",
  cook: "",
  sourceUrl: "https://example.com/soup",
  sourceCopy: true,
  lines: [
    {
      clientId: "fixture-line",
      name: "Flour",
      amount: "1/2",
      unit: "cup",
      note: "Keep this note",
      ingredientId: null,
      originalName: null,
    },
  ],
};
let rows: ReviewDocumentEntry[];
const store = {
  initialize: jest.fn(),
  refresh: jest.fn(),
  read: jest.fn(),
  begin: jest.fn(),
  save: jest.fn(),
  freeze: jest.fn(),
  sendExact: jest.fn(),
  retireConfirmed: jest.fn(),
  hasUncertainStorage: jest.fn(),
};
beforeEach(() => {
  jest.clearAllMocks();
  rows = [];
  jest.mocked(readReviewDocumentContext).mockResolvedValue(context);
  jest
    .mocked(browserReviewDocument)
    .mockReturnValue(
      store as unknown as ReturnType<typeof browserReviewDocument>,
    );
  store.initialize.mockImplementation(async () => rows);
  store.refresh.mockImplementation(async () => rows);
  store.read.mockImplementation(async () => ({
    entry: rows[0],
    document: reviewDocumentPayload.parse(JSON.parse(rows[0].body)),
  }));
  store.begin.mockImplementation(async (key, document) => {
    rows = [
      { key, kind: "editable-review-document", body: JSON.stringify(document) },
    ];
    return rows[0];
  });
  store.save.mockImplementation(
    async (key, _body, documentDraft, provenance) => {
      const previous = JSON.parse(rows[0].body);
      rows = [
        {
          key,
          kind: "editable-review-document",
          body: JSON.stringify({
            ...previous,
            draft: documentDraft,
            provenance,
          }),
        },
      ];
      return rows[0];
    },
  );
  store.freeze.mockImplementation(async (key, _body, requests) => {
    const document = JSON.parse(rows[0].body),
      now = Date.now();
    rows = [
      {
        key,
        kind: "submitted-review-document",
        body: JSON.stringify({
          ...document,
          phase: "submitted",
          updatedAt: now,
          frozenAt: now,
          expiresAt: now + 86400000,
          requests,
        }),
      },
    ];
    return rows[0];
  });
  store.sendExact.mockResolvedValue({
    sent: true,
    result: { kind: "unknown" },
  });
  store.retireConfirmed.mockResolvedValue(false);
  store.hasUncertainStorage.mockReturnValue(false);
});
it("offers explicit restore and retains partial amounts, unknown servings and all edited lines", async () => {
  const document = newReviewDocument(
    context,
    draft,
    {
      source: "recipe-link",
      sourceUrl: draft.sourceUrl,
      confidence: "unknown",
      unknowns: ["servings"],
      evaluatedAt: null,
    },
    Date.now(),
  );
  rows = [
    {
      key: "fixture_document_key",
      kind: "editable-review-document",
      body: JSON.stringify(document),
    },
  ];
  render(<RecipeEditor onCancel={jest.fn()} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Restore saved draft" }),
  );
  expect(await screen.findByLabelText("Recipe name")).toHaveValue(
    "Original soup",
  );
  expect(screen.getByLabelText("Base servings")).toHaveValue("");
  expect(screen.getByLabelText("Amount")).toHaveValue("1/2");
  expect(screen.getByLabelText("Ingredient note")).toHaveValue(
    "Keep this note",
  );
  expect(screen.getByLabelText("Prep (min)")).toHaveValue("1.");
  expect(store.freeze).not.toHaveBeenCalled();
  expect(store.sendExact).not.toHaveBeenCalled();
});
it("locks an unknown create and checks the identical saved request on retry", async () => {
  render(<RecipeEditor onCancel={jest.fn()} onCreated={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("Recipe name"), {
    target: { value: "Family soup" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() => expect(store.sendExact).toHaveBeenCalledTimes(1));
  const first = store.sendExact.mock.calls[0].slice(0, 3);
  expect(
    screen.queryByRole("textbox", { name: "Recipe name" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: "Check the same save" }),
  );
  await waitFor(() => expect(store.sendExact).toHaveBeenCalledTimes(2));
  expect(store.sendExact.mock.calls[1].slice(0, 3)).toEqual(first);
  expect(store.freeze).toHaveBeenCalledTimes(1);
});
it("withholds the form after a renewed household changes", async () => {
  render(<RecipeEditor onCancel={jest.fn()} />);
  await screen.findByLabelText("Recipe name");
  fireEvent(window, new Event("blur"));
  jest
    .mocked(readReviewDocumentContext)
    .mockResolvedValue({ ...context, familyId: "fixture-family-b" });
  fireEvent(window, new Event("focus"));
  await screen.findByText(
    "Your account or household changed. Reload before opening saved work.",
  );
  expect(
    screen.queryByRole("textbox", { name: "Recipe name" }),
  ).not.toBeInTheDocument();
  expect(store.sendExact).not.toHaveBeenCalled();
});

it("keeps the unadopted legacy editor independent of browser recovery stores", async () => {
  jest
    .mocked(readReviewDocumentContext)
    .mockResolvedValue({ ...context, enabled: false, adopted: false });
  render(<RecipeEditor onCancel={jest.fn()} />);
  await screen.findByLabelText("Recipe name");
  expect(browserReviewDocument).not.toHaveBeenCalled();
});
