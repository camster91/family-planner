/** @jest-environment jsdom */
/** Authored/unrun explicit discovery and stale asynchronous result cases. */
import "@testing-library/jest-dom";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import SavedRequestsReview from "../SavedRequestsReview";
import { readSavedReviewRequests } from "@/lib/review-inbox/saved-requests";
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/calendar/preparation/PreparationProvider", () => ({
  usePreparationActive: () => false,
}));
jest.mock("@/components/calendar/review/ScheduleReviewProvider", () => ({
  useScheduleReviewActive: () => false,
}));
jest.mock("@/lib/review-inbox/saved-requests", () => ({
  readSavedReviewRequests: jest.fn(),
}));
const identity = { userId: "parent-a", familyId: "family-a" };
function view(value = identity) {
  return (
    <I18nProvider locale="en">
      <SavedRequestsReview identity={value} />
    </I18nProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});
it("does not read on mount and never describes an unknown request as confirmed", async () => {
  jest.mocked(readSavedReviewRequests).mockResolvedValue({
    items: [
      {
        id: "preparation-0",
        kind: "preparation",
        issuedAt: "2026-10-21T12:00:00.000Z",
        href: "/dashboard/calendar?prepareEvent=event-a&prepareZone=UTC",
      },
    ],
    paused: false,
  });
  render(view());
  expect(readSavedReviewRequests).not.toHaveBeenCalled();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Check this device" }));
  expect(await screen.findByText("Saved preparation request")).toBeVisible();
  expect(screen.getByText(/Result not checked here/)).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Open recovery screen" }),
  ).toHaveAttribute("href", expect.stringContaining("prepareEvent=event-a"));
});
it("ignores a late old-owner result after the current identity changes", async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof readSavedReviewRequests>>,
  ) => void;
  jest.mocked(readSavedReviewRequests).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const mounted = render(view());
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Check this device" }));
  await waitFor(() => expect(readSavedReviewRequests).toHaveBeenCalledTimes(1));
  mounted.rerender(view({ ...identity, familyId: "family-b" }));
  await act(async () =>
    finish({
      items: [
        {
          id: "old",
          kind: "preparation",
          issuedAt: "2026-10-21T12:00:00.000Z",
          href: "/dashboard/calendar?prepareEvent=private-old",
        },
      ],
      paused: false,
    }),
  );
  expect(
    screen.queryByText("Saved preparation request"),
  ).not.toBeInTheDocument();
});
