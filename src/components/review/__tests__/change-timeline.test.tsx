/** @jest-environment jsdom */
/** Authored only; no rendered acceptance claim. */
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import ChangeTimeline from "../ChangeTimeline";
import { requestOwnedJson } from "@/lib/owned-request-http";
import type { TimelinePage } from "@/lib/review-inbox/timeline-contract";
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/components/calendar/preparation/PreparationProvider", () => ({
  usePreparationActive: () => false,
}));
jest.mock("@/components/calendar/review/ScheduleReviewProvider", () => ({
  useScheduleReviewActive: () => false,
}));
jest.mock("@/lib/owned-request-http", () => ({ requestOwnedJson: jest.fn() }));
const identity = { userId: "fixture-parent", familyId: "fixture-family" };
const page = (generation = 3): TimelinePage => ({
  owner: { ...identity, generation },
  source: "all",
  nextCursor: null,
  entries: Array.from({ length: 6 }, (_, i) => ({
    id: `activity:${i}`,
    action: "recipe_created",
    at: "2026-10-22T12:00:00.000Z",
    actor: { name: "Synthetic parent", kind: "person" },
    origin: "recipes",
    featureKey: null,
    title: `Synthetic recipe ${i}`,
    target: { kind: "recipe", id: `recipe-${i}` },
    current: "available",
  })),
});
const reply = (body: TimelinePage) => ({
  kind: "reply" as const,
  response: { ok: true, status: 200 } as Response,
  body,
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(requestOwnedJson).mockResolvedValue(reply(page()));
});
it("reads only on request, uses five-row windows and clears private contents on blur", async () => {
  render(<ChangeTimeline identity={identity} />);
  expect(requestOwnedJson).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
  expect(await screen.findByText(/Synthetic recipe 0/)).toBeVisible();
  expect(screen.getAllByRole("link", { name: "Open record" })).toHaveLength(5);
  expect(screen.queryByText(/Synthetic recipe 5/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText(/Synthetic recipe 5/)).toBeVisible();
  act(() => window.dispatchEvent(new Event("blur")));
  expect(screen.queryByText(/Synthetic recipe/)).not.toBeInTheDocument();
});
it("refuses a replacement generation instead of silently adopting it after a refresh", async () => {
  render(<ChangeTimeline identity={identity} />);
  fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
  await screen.findByText(/Synthetic recipe 0/);
  jest.mocked(requestOwnedJson).mockResolvedValueOnce(reply(page(4)));
  fireEvent.click(screen.getByRole("button", { name: "Refresh changes" }));
  await screen.findByText(/account, household or session changed/);
  expect(screen.queryByText(/Synthetic recipe/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Refresh changes" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "What changed" }), {
    target: { value: "settings" },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Refresh changes" }),
    ).toBeDisabled(),
  );
  expect(requestOwnedJson).toHaveBeenCalledTimes(2);
});
