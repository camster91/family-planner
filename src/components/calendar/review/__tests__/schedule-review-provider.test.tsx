/** Authored only: privacy/navigation cases, no browser/native execution. */
import * as React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import Provider, { ScheduleReviewButton } from "../ScheduleReviewProvider";
const mockPush = jest.fn(),
  mockReplace = jest.fn(),
  mockBack = jest.fn();
let mockQuery = "";
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/calendar",
  useSearchParams: () => new URLSearchParams(mockQuery),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
}));
jest.mock("@/i18n/schedule-review", () => ({
  useScheduleReviewText: () => ({
    open: "Review timing",
    loading: "Loading",
    close: "Close timing review",
    error: "Unavailable",
  }),
}));
jest.mock("../ScheduleReviewSheet", () => ({
  __esModule: true,
  default: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close stub review</button>
  ),
}));
const scope = {
  targetId: "event-a",
  range: { start: "2026-10-19T00:00:00Z", end: "2026-10-26T00:00:00Z" },
  timeZone: "America/Toronto",
};
function tree(enabled = true, role = "parent") {
  return (
    <Provider enabled={enabled} role={role}>
      <ScheduleReviewButton scope={scope} />
    </Provider>
  );
}
const deepLink = () =>
  new URLSearchParams({
    reviewEvent: scope.targetId,
    reviewStart: scope.range.start,
    reviewEnd: scope.range.end,
    reviewZone: scope.timeZone,
  }).toString();
beforeEach(() => {
  jest.clearAllMocks();
  mockQuery = "";
});
it("does not load a personal review on the fridge even with a direct review URL", () => {
  mockQuery = `mode=fridge&${deepLink()}`;
  render(tree());
  expect(
    screen.queryByRole("button", { name: "Review timing" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Close stub review" }),
  ).not.toBeInTheDocument();
});
it("preserves weekly/navigation fields and uses Back for its own opening", async () => {
  mockQuery = "weeklyReview=1&view=week";
  const rendered = render(tree());
  fireEvent.click(screen.getByRole("button", { name: "Review timing" }));
  const url = mockPush.mock.calls[0][0] as string;
  expect(new URL(url, "http://test").searchParams.get("weeklyReview")).toBe(
    "1",
  );
  mockQuery = url.split("?")[1];
  rendered.rerender(tree());
  fireEvent.click(
    await screen.findByRole("button", { name: "Close stub review" }),
  );
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});
it("keeps recovery reachable by an existing URL while readiness hides new entry buttons, and closes only its own query fields", async () => {
  mockQuery = `weeklyReview=1&${deepLink()}`;
  render(tree(false));
  expect(
    screen.queryByRole("button", { name: "Review timing" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("button", { name: "Close stub review" }),
  );
  expect(mockReplace).toHaveBeenCalledWith(
    "/dashboard/calendar?weeklyReview=1",
    {
      scroll: false,
    },
  );
  expect(mockBack).not.toHaveBeenCalled();
});
