/** @jest-environment jsdom */
/** Authored/unrun canonical-host state retention and identity masks. */
import * as React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewInbox from "../ReviewInbox";
import { I18nProvider } from "@/i18n";
import type { InboxPage } from "@/lib/review-inbox/read";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/calendar/preparation/PreparationProvider", () => ({
  usePreparationActive: () => false,
}));
jest.mock("@/components/calendar/review/ScheduleReviewProvider", () => ({
  useScheduleReviewActive: () => false,
}));
jest.mock("@/components/capture/CaptureBox", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    CaptureBox: function FixtureCapture() {
      const [value, setValue] = React.useState("");
      return (
        <input
          aria-label="Fixture capture draft"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    },
  };
});

const identity = { userId: "parent-a", familyId: "family-a" };
function view(
  source: InboxPage["source"],
  owner = identity,
  items: InboxPage["items"] = [],
) {
  return (
    <I18nProvider locale="en">
      <ReviewInbox
        identity={owner}
        page={{ source, state: "available", items, next: null }}
      />
    </I18nProvider>
  );
}
it("keeps the canonical draft mounted while switching inbox panes, then clears it for another owner", async () => {
  const mounted = render(view("capture"));
  await userEvent
    .setup()
    .type(
      await screen.findByLabelText("Fixture capture draft"),
      "Unfinished notice",
    );
  mounted.rerender(view("checks"));
  expect(screen.getByLabelText("Fixture capture draft")).not.toBeVisible();
  mounted.rerender(view("capture"));
  expect(screen.getByLabelText("Fixture capture draft")).toHaveValue(
    "Unfinished notice",
  );
  mounted.rerender(view("capture", { ...identity, familyId: "family-b" }));
  expect(await screen.findByLabelText("Fixture capture draft")).toHaveValue("");
});
it("does not initialize capture merely to show another inbox category", () => {
  render(view("checks"));
  expect(
    screen.queryByLabelText("Fixture capture draft"),
  ).not.toBeInTheDocument();
});
it("opens a check at its exact chore focus instead of the generic chore board", () => {
  render(
    view("checks", identity, [
      { id: "chore-a", title: "Take out trash", kind: "check" },
    ]),
  );
  expect(screen.getByRole("link", { name: "Open chore checks" })).toHaveAttribute(
    "href",
    "/dashboard/chores?focus=chore-a",
  );
});
