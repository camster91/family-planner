jest.mock("@/lib/idempotency", () => ({
  hashIdempotentRequest: () => "f".repeat(64),
}));
/** Authored/unrun compact-window and stale asynchronous picker cases. */
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PreparationPicker from "../PreparationPicker";
import { readPreparationPicker } from "@/lib/event-preparation/client";
import { preparationRecoveryFixture } from "@/lib/event-preparation/__tests__/recovery-fixture";
jest.mock("@/lib/event-preparation/client", () => ({
  readPreparationPicker: jest.fn(),
}));
jest.mock("@/i18n/event-preparation", () => ({
  usePreparationText: () => ({
    search: "Search",
    find: "Find",
    more: "Next results",
    first: "First results",
    empty: "No matches on this page",
    incomplete: "More results",
    loading: "Loading",
    error: "Could not load",
    reload: "Refresh",
  }),
}));
it("shows five candidates at a time without skipping the remaining IDs in the fetched page", async () => {
  const { recovery } = preparationRecoveryFixture();
  jest.mocked(readPreparationPicker).mockResolvedValue({
    owner: { userId: recovery.userId, familyId: recovery.familyId },
    eventId: "event-a",
    kind: "tasks",
    search: "",
    after: null,
    next: null,
    items: Array.from({ length: 12 }, (_, index) => ({
      kind: "task",
      id: `task-${index}`,
      title: `Fixture task ${index}`,
      dueDay: "2026-10-21",
      subjectName: "Fixture person",
    })),
  });
  render(
    <PreparationPicker
      location={{ eventId: "event-a", timeZone: "UTC" }}
      context={recovery}
      kind="tasks"
      onPick={jest.fn()}
      disabled={false}
    />,
  );
  await screen.findByText("Fixture task 0");
  expect(screen.queryByText("Fixture task 5")).toBeNull();
  fireEvent.click(screen.getByText("Next results"));
  await screen.findByText("Fixture task 5");
  expect(screen.queryByText("Fixture task 0")).toBeNull();
  expect(readPreparationPicker).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText("Next results"));
  await screen.findByText("Fixture task 10");
  await waitFor(() => expect(screen.getByText("Next results")).toBeDisabled());
});
