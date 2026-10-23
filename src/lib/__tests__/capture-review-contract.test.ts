/** Authored/unrun normalized review boundaries; no provider accuracy evidence. */
import {
  captureTextReview,
  capturePhotoReview,
} from "../capture-review-contract";
it("keeps null provider fields unknown without guessing a draft kind", () => {
  expect(
    captureTextReview.parse({
      kind: "event",
      title: "Trip",
      start_time: null,
      end_time: null,
      location: null,
      list_name: null,
      note: null,
    }),
  ).toMatchObject({
    kind: "event",
    title: "Trip",
    confidence: "low",
    start_time: undefined,
  });
  expect(
    captureTextReview.safeParse({ kind: "unexpected", title: "Trip" }).success,
  ).toBe(false);
});
it("does not turn malformed photo output into an empty review", () => {
  expect(capturePhotoReview.safeParse({ events: "none" }).success).toBe(false);
  expect(capturePhotoReview.safeParse({ note: "No events" }).success).toBe(
    false,
  );
  expect(capturePhotoReview.parse({ events: [], note: null })).toEqual({
    events: [],
    confidence: "low",
    note: undefined,
  });
});
it("holds oversized proposals instead of silently dropping content", () => {
  expect(
    capturePhotoReview.safeParse({
      events: Array.from({ length: 21 }, () => ({ title: "Event" })),
    }).success,
  ).toBe(false);
  expect(
    captureTextReview.safeParse({ kind: "event", title: "x".repeat(201) })
      .success,
  ).toBe(false);
  expect(
    captureTextReview.safeParse({
      kind: "event",
      title: "Trip",
      note: { secret: "not text" },
    }).success,
  ).toBe(false);
});
it("refuses unsupported timestamps and private extra fields", () => {
  expect(
    captureTextReview.safeParse({
      kind: "event",
      title: "Trip",
      start_time: "next Wednesday",
    }).success,
  ).toBe(false);
  expect(
    captureTextReview.safeParse({
      kind: "event",
      title: "Trip",
      rawPhoto: "private",
    }).success,
  ).toBe(false);
});
