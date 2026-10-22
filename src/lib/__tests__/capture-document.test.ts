/** Authored only. No tests have been run in this source pass. */
import {
  captureReviewDocument,
  captureReviewInstant,
  captureRequestDrafts,
} from "../capture-document";
import { reviewDocumentPayload } from "../review-document-contract";
import type { CaptureEditableDocument } from "../capture-document";
import { captureChoreDraft } from "../capture-chore-review";
const row = {
  clientId: "fixture_event",
  kind: "event" as const,
  title: "Fixture event",
  startTime: "2026-10-21T10:30:00-04:00",
  endTime: "",
  location: "",
  eventType: "family",
  listName: "",
  quantity: "1",
};
it("keeps missing fields, normalized notes and stable client row identity without prompt/photo bytes", () => {
  const result = captureReviewDocument(
    {
      clientId: "fixture_row",
      kind: "task",
      title: "Fixture task",
      confidence: "low",
      note: "Check this detail",
      quantity: "1.",
    },
    null,
    null,
  );
  expect(result.rows[0]).toMatchObject({
    clientId: "fixture_row",
    kind: "task",
    startTime: "",
    quantity: "1.",
  });
  expect(result.note).toBe("Check this detail");
  expect(Object.keys(result).sort()).toEqual(["domain", "note", "rows"]);
});
it("prepares the entire event/grocery batch while preserving editable source strings", () => {
  const draft: CaptureEditableDocument = {
    domain: "capture",
    note: "",
    rows: [
      row,
      {
        ...row,
        clientId: "fixture_grocery",
        kind: "listitem",
        title: "Milk",
        quantity: "2",
      },
    ],
  };
  const original = JSON.stringify(draft);
  const requests = captureRequestDrafts(draft);
  expect(requests.map((value) => value.action)).toEqual([
    "event.create",
    "capture.grocery.add",
  ]);
  expect(JSON.parse(requests[0].body).start_time).toBe(
    "2026-10-21T14:30:00.000Z",
  );
  expect(JSON.parse(requests[1].body)).toEqual({
    content: "Milk",
    quantity: 2,
  });
  expect(JSON.stringify(draft)).toBe(original);
});
it.each([
  "tomorrow",
  "2026-02-30T12:00:00Z",
  "2026-10-21T24:00:00Z",
  "2026-10-21",
])("refuses invalid or ambiguous date syntax %s", (value) => {
  expect(() => captureReviewInstant(value)).toThrow();
});
it("refuses task conversion and fractional/empty quantities before preparing a submit", () => {
  expect(() =>
    captureRequestDrafts({
      domain: "capture",
      note: "",
      rows: [{ ...row, kind: "task" }],
    }),
  ).toThrow("CAPTURE_TASK_REVIEW_REQUIRED");
  for (const quantity of ["", "1.", "1/2", "0x10", "1e2"])
    expect(() =>
      captureRequestDrafts({
        domain: "capture",
        note: "",
        rows: [{ ...row, kind: "listitem", quantity }],
      }),
    ).toThrow();
});
it("binds a frozen batch to every reviewed row's domain and count", () => {
  const payload = {
    userId: "fixture-parent",
    familyId: "fixture-family",
    phase: "submitted",
    createdAt: 1000,
    updatedAt: 1000,
    frozenAt: 1000,
    expiresAt: 2000,
    provenance: {
      source: "manual",
      sourceUrl: null,
      confidence: "unknown",
      unknowns: [],
      evaluatedAt: null,
    },
    draft: { domain: "capture", note: "", rows: [row] },
    requests: [
      {
        key: "fixture_event_request",
        ...captureRequestDrafts({
          domain: "capture",
          note: "",
          rows: [row],
        })[0],
      },
    ],
  };
  expect(reviewDocumentPayload.safeParse(payload).success).toBe(true);
  expect(
    reviewDocumentPayload.safeParse({
      ...payload,
      draft: { ...payload.draft, rows: [{ ...row, kind: "task" }] },
    }).success,
  ).toBe(false);
  expect(
    reviewDocumentPayload.safeParse({
      ...payload,
      draft: {
        ...payload.draft,
        rows: [row, { ...row, clientId: "fixture_second" }],
      },
    }).success,
  ).toBe(false);
});

it("retains a partial chore editor but only freezes an explicitly reviewed canonical task", () => {
  const draft = captureChoreDraft.parse({
    title: "Fixture task",
    description: "Parent instructions",
    points: "1.",
    assignment: { kind: "account", id: "" },
    dueDate: "2099-",
    weeklyStart: "",
    frequency: "weekly",
    difficulty: "medium",
    weeklyDays: [1, 4],
    photoUrl: null,
    icon: null,
    routine: "Morning",
    routineOrder: "2.",
    takeTurns: false,
    rotation: [],
  });
  const task = {
    ...row,
    kind: "task" as const,
    title: draft.title,
    chore: { draft, reviewed: null },
  };
  expect(JSON.parse(JSON.stringify(task)).chore.draft).toEqual(draft);
  expect(() =>
    captureRequestDrafts({ domain: "capture", note: "", rows: [task] }),
  ).toThrow("CAPTURE_TASK_REVIEW_REQUIRED");
  const reviewed = {
    action: "chore.create" as const,
    body: JSON.stringify({
      title: draft.title,
      points: 10,
      assigned_to: "fixture-child-account",
      due_date: "2099-10-05",
      frequency: "weekly",
      weekly_days: [1, 4],
    }),
  };
  const batch: CaptureEditableDocument = {
    domain: "capture",
    note: "",
    rows: [row, { ...task, chore: { draft, reviewed } }],
  };
  expect(captureRequestDrafts(batch).map((item) => item.action)).toEqual([
    "event.create",
    "chore.create",
  ]);
  expect(captureRequestDrafts(batch)[1].body).toBe(reviewed.body);
  expect(() =>
    captureRequestDrafts({
      ...batch,
      rows: [{ ...batch.rows[1], title: "Changed after review" }],
    }),
  ).toThrow("CAPTURE_TASK_REVIEW_REQUIRED");
});
