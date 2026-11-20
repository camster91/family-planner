/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import ChoresContent from "../ChoresContent";
import { personFilterStorageKey } from "@/lib/person-filter-preference";
import type { Chore } from "@/types";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => false,
}));
const row = (id: string, extra: Partial<Chore> & Record<string, unknown> = {}) => ({
  id,
  family_id: "family",
  title: id,
  assigned_to: "mia",
  points: 0,
  due_date: "2026-10-09",
  status: "pending" as const,
  frequency: "once" as const,
  difficulty: "easy" as const,
  created_at: "2026-10-01",
  assignee: { name: "Mia Fixture-A" },
  creator: { name: "Avery Fixture-A" },
  ...extra,
});
const people = [
  { key: "account:avery", name: "Avery Fixture-A", color: "indigo" },
  { key: "account:mia", name: "Mia Fixture-A", color: "green" },
  { key: "profile:kid", name: "Robin", color: "orange" },
];
const chores = [
  row("Feed the cat"),
  row("Tidy room", {
    assigned_to: null,
    assigned_member_id: "kid",
    assignee: { name: "Robin" },
    subject: { kind: "profile", memberId: "kid", name: "Robin", role: "child" },
  }),
  row("Water plants", { status: "completed", photo_url: null }),
];
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 9, 9, 12));
  localStorage.clear();
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true }),
  })) as unknown as typeof fetch;
});
afterEach(() => jest.useRealTimers());
const mount = () =>
  render(
    <I18nProvider locale="en">
      <ToastProvider>
        <ChoresContent
          chores={chores as never}
          people={people}
          familyMembers={[
            { id: "avery", name: "Avery Fixture-A", role: "parent" },
            { id: "mia", name: "Mia Fixture-A", role: "child" },
          ]}
          currentUserId="avery"
          userRole="parent"
        />
      </ToastProvider>
    </I18nProvider>,
  );

it("shows a face and the first name of who each chore is for", async () => {
  mount();
  await act(async () => {});
  const feed = screen.getByRole("checkbox", { name: "Feed the cat" });
  expect(feed).toHaveAccessibleDescription(/^Mia · Today/);
  const avatars = document.querySelectorAll('[data-member-color="green"]');
  expect(avatars.length).toBeGreaterThan(0);
  expect(avatars[0].textContent).toBe("M");
  expect(screen.getByRole("checkbox", { name: "Tidy room" })).toHaveAccessibleDescription(/^Robin/);
  expect(document.body.textContent).not.toContain("Mia Fixture-A");
  expect(screen.getByText(/Assigned to Mia/)).toBeInTheDocument();
});

it("filters chores and checks to one person and remembers it on this device", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const first = mount();
  await act(async () => {});
  const group = screen.getByRole("group", { name: "Show chores for" });
  expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["Everyone", "AAvery", "MMia", "RRobin"]);
  await user.click(within(group).getByRole("button", { name: /Robin/ }));
  expect(screen.getByRole("checkbox", { name: "Tidy room" })).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "Feed the cat" })).toBeNull();
  // Mia's chore waiting for a check is hidden while Robin is chosen.
  expect(screen.queryByText("Water plants")).toBeNull();
  expect(localStorage.getItem(personFilterStorageKey("chores"))).toBe("profile:kid");
  first.unmount();

  mount();
  await act(async () => {});
  expect(screen.getByRole("button", { name: /Robin/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("checkbox", { name: "Feed the cat" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Everyone" }));
  expect(screen.getByRole("checkbox", { name: "Feed the cat" })).toBeInTheDocument();
  expect(screen.getByText("Water plants")).toBeInTheDocument();
});
