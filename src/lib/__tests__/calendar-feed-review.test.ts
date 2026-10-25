import { feedReviewCursor, parseFeedReviewCursor } from "../calendar-feed-review";
import { calendarFeedReviewPage } from "../calendar-feed-review-contract";
it("binds canonical cursor encoding to this household", () => {
  const cursor = feedReviewCursor("family-a", "event-a");
  expect(parseFeedReviewCursor(new URLSearchParams({ cursor }), "family-a")).toBe("event-a");
  expect(() => parseFeedReviewCursor(new URLSearchParams({ cursor }), "family-b")).toThrow();
  expect(() => parseFeedReviewCursor(new URLSearchParams(`cursor=${cursor}&cursor=${cursor}`), "family-a")).toThrow();
  expect(() => parseFeedReviewCursor(new URLSearchParams({ cursor: cursor + "=" }), "family-a")).toThrow();
});
it("refuses impossible diagnostic envelopes without adopting a successful partial response", () => {
  const issue = { id: "event-a", title: "Fixture", source: "local" };
  for (const body of [{ checked: 0, issues: [issue], nextCursor: null },
    { checked: 2, issues: [issue, issue], nextCursor: null },
    { checked: 1, issues: [], nextCursor: "next" }])
    expect(calendarFeedReviewPage.safeParse(body).success).toBe(false);
});
