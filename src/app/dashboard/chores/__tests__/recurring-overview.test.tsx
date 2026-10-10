/** @jest-environment jsdom */
import * as React from "react";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChoresContent from "../ChoresContent";
import { ToastProvider } from "@/components/ui/toast";
import type { Chore } from "@/types";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => false,
}));
const row = (id: string, due_date: string, extra: Partial<Chore> = {}) => ({
  id,
  due_date,
  family_id: "f",
  title: "Take out trash",
  assigned_to: "adult",
  points: 0,
  status: "pending" as const,
  frequency: "once" as const,
  difficulty: "easy" as const,
  created_at: "2026-10-01",
  assignee: { name: "Alex" },
  creator: { name: "Alex" },
  recurrence_id: "series",
  recurrence_frequency: "weekly" as const,
  recurrence_weekly_days: [1, 4],
  ...extra,
});
const chores = [
  row("first", "2026-10-09"),
  row("second", "2026-10-12"),
  row("third", "2026-10-15"),
  row("standalone", "2026-10-13", { title: "Other task", recurrence_id: null }),
];
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 9, 12));
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  })) as unknown as typeof fetch;
});
afterEach(() => jest.useRealTimers());
const mount = () =>
  render(
    <ToastProvider>
      <ChoresContent
        chores={chores}
        familyMembers={[{ id: "adult", name: "Alex", role: "parent" }]}
        currentUserId="adult"
        userRole="parent"
      />
    </ToastProvider>,
  );
it("collapses Week/All, preserves Today, and completes only an expanded occurrence", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { container } = mount();
  expect(container.querySelector("details")).toBeNull();
  await user.click(screen.getByRole("button", { name: "All" }));
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toContain(
    "Weekly · Monday, Thursday",
  );
  expect(details.querySelector("summary")?.textContent).toContain(
    "3 open dates",
  );
  expect(screen.getByText("Other task")).toBeTruthy();
  fireEvent.click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  // Existing row checkbox targets an occurrence; the summary never completes the series.
  const checks = within(details).getAllByRole("checkbox");
  await user.click(checks[1]);
  await waitFor(() =>
    expect(
      (global.fetch as jest.Mock).mock.calls.some(
        ([url, init]) =>
          url === "/api/chores/complete" &&
          JSON.parse(init.body).choreId === "second",
      ),
    ).toBe(true),
  );
  expect(
    (global.fetch as jest.Mock).mock.calls.filter(
      ([url]) => url === "/api/chores/complete",
    ),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Today" }));
  expect(container.querySelector("details")).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Take out trash" })).toBeTruthy();
});
it("Week also starts collapsed and counts only open dates in its filter", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const { container } = mount();
  await user.click(screen.getByRole("button", { name: "Week" }));
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("summary")?.textContent).toContain(
    "3 open dates",
  );
});
