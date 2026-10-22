/** @jest-environment jsdom */
/** Authored source cases; execution and rendered acceptance remain deferred. */
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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
import { CaptureBox } from "../CaptureBox";
import {
  readReviewDocumentContext,
  browserReviewDocument,
} from "@/lib/review-document-browser";
import {
  reviewDocumentContext,
  reviewDocumentPayload,
  REVIEW_DOCUMENT_CONTRACT,
  type ReviewDocumentEntry,
} from "@/lib/review-document-contract";
import { newReviewDocument } from "@/lib/review-document-store";
const context = reviewDocumentContext.parse({
  contract: REVIEW_DOCUMENT_CONTRACT,
  userId: "fixture-parent",
  familyId: "fixture-family",
  domain: "capture",
  role: "parent",
  enabled: true,
  adopted: true,
  owner: {
    kind: "person",
    ownerId: "fixture-parent",
    generation: 0,
    scope: "a".repeat(64),
    householdScope: "b".repeat(64),
  },
});
let rows: ReviewDocumentEntry[];
const store = {
  initialize: jest.fn(),
  refresh: jest.fn(),
  read: jest.fn(),
  begin: jest.fn(),
  save: jest.fn(),
  freeze: jest.fn(),
  sendExact: jest.fn(),
  inspectReceipt: jest.fn(),
  inspectReceipts: jest.fn(),
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
  store.save.mockImplementation(async (key, _body, draft, provenance) => {
    rows = [
      {
        key,
        kind: "editable-review-document",
        body: JSON.stringify({
          ...JSON.parse(rows[0].body),
          draft,
          provenance,
        }),
      },
    ];
    return rows[0];
  });
  store.freeze.mockImplementation(async (key, _body, requests) => {
    const now = Date.now();
    rows = [
      {
        key,
        kind: "submitted-review-document",
        body: JSON.stringify({
          ...JSON.parse(rows[0].body),
          phase: "submitted",
          frozenAt: now,
          updatedAt: now,
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
  store.hasUncertainStorage.mockReturnValue(false);
  global.fetch = jest.fn(
    async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          configured: false,
          allowed: true,
          role: "parent",
          userId: context.userId,
          familyId: context.familyId,
        }),
      }) as Response,
  );
});
it("restores reviewed fields with partial quantities while extraction is unconfigured", async () => {
  const document = newReviewDocument(
    context,
    {
      domain: "capture",
      note: "Keep this review note",
      rows: [
        {
          clientId: "fixture_grocery",
          kind: "listitem",
          title: "Fixture milk",
          quantity: "1.",
          startTime: "",
          endTime: "",
          location: "",
          eventType: "other",
          listName: "Original suggested list",
        },
      ],
    },
    {
      source: "text-review",
      sourceUrl: null,
      confidence: "low",
      unknowns: [],
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
  render(<CaptureBox />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Restore review" }),
  );
  expect(await screen.findByLabelText("Title")).toHaveValue("Fixture milk");
  expect(screen.getByLabelText("Quantity")).toHaveValue("1.");
  expect(screen.getByLabelText("Review notes")).toHaveValue(
    "Keep this review note",
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Read it" }),
    ).not.toBeInTheDocument(),
  );
  expect(store.sendExact).not.toHaveBeenCalled();
  expect(store.freeze).not.toHaveBeenCalled();
});
it("keeps an unknown grocery save frozen and retries the identical saved request", async () => {
  render(<CaptureBox />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add groceries manually" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Fixture milk" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add to groceries" }));
  await waitFor(() => expect(store.sendExact).toHaveBeenCalledTimes(1));
  const original = store.sendExact.mock.calls[0].slice(0, 3);
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Check and add remaining items",
    }),
  );
  await waitFor(() => expect(store.sendExact).toHaveBeenCalledTimes(2));
  expect(store.sendExact.mock.calls[1].slice(0, 3)).toEqual(original);
  expect(store.freeze).toHaveBeenCalledTimes(1);
});
it("clears private rendered fields when renewed household ownership changes", async () => {
  render(<CaptureBox />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add groceries manually" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Private fixture title" },
  });
  fireEvent(window, new Event("blur"));
  jest
    .mocked(readReviewDocumentContext)
    .mockResolvedValue({ ...context, familyId: "fixture-other-family" });
  fireEvent(window, new Event("focus"));
  await screen.findByText(
    "Your account or household changed. Reload before opening saved work.",
  );
  expect(
    screen.queryByRole("textbox", { name: "Title" }),
  ).not.toBeInTheDocument();
  expect(store.sendExact).not.toHaveBeenCalled();
});
