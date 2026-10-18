/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import ChoresContent from "../ChoresContent";
import type { Chore } from "@/types";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => false,
}));
const row = (id: string, extra: Partial<Chore> = {}) => ({
  id,
  family_id: "family",
  title: id,
  assigned_to: "adult",
  points: 0,
  due_date: "2026-10-09",
  status: "pending" as const,
  frequency: "once" as const,
  difficulty: "easy" as const,
  created_at: "2026-10-01",
  assignee: { name: "Alex" },
  creator: { name: "Alex" },
  ...extra,
});
const steps = [
  row("Pack bag", {
    routine: "Morning reset",
    routine_order: 1,
    routine_stack_id: "stack",
  }),
  row("Check lunch", {
    routine: "Morning reset",
    routine_order: 2,
    routine_stack_id: "stack",
  }),
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
function mount(
  chores = [...steps, row("Take recycling")],
  locale: "en" | "es" = "en",
  role = "parent",
) {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <ChoresContent
          chores={chores}
          familyMembers={[{ id: "adult", name: "Alex", role: "parent" }]}
          currentUserId="adult"
          userRole={role}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}
it("shows routine context with daily work once and completes the exact routine occurrence", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  mount();
  const controls = screen.getByRole("group", { name: "Chore views" });
  expect(
    within(controls)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual(["Today", "Week", "Series"]);
  expect(
    within(controls).getByRole("button", { name: "Today" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    screen.getByText("Now", { selector: "p" }).closest("section"),
  ).toHaveTextContent("Take recycling");
  expect(screen.getAllByRole("checkbox", { name: "Pack bag" })).toHaveLength(1);
  const routine = screen.getByRole("region", {
    name: "Morning reset · Alex · Oct 9",
  });
  expect(routine).toHaveTextContent("0 of 2 done · 0 checked");
  await user.click(within(routine).getByRole("checkbox", { name: "Pack bag" }));
  await waitFor(() =>
    expect(routine).toHaveTextContent("1 of 2 done · 0 checked"),
  );
  const writes = (global.fetch as jest.Mock).mock.calls.filter(
    ([url]) => url === "/api/chores/complete",
  );
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0][1].body).choreId).toBe("Pack bag");
  expect(
    within(routine).getByRole("checkbox", { name: "Check lunch" }),
  ).not.toBeChecked();
});
it("keeps Series separate from all chores and retains routine date ranges", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const weekly = {
    recurrence_id: "weekly",
    recurrence_frequency: "weekly" as const,
    recurrence_weekly_days: [1, 4],
  };
  mount([
    row("weekly-one", { ...weekly, title: "Laundry" }),
    row("weekly-two", { ...weekly, title: "Laundry", due_date: "2026-10-12" }),
    row("One-off"),
    ...steps,
  ]);
  await user.click(screen.getByRole("button", { name: "Series" }));
  expect(screen.queryByText("One-off")).toBeNull();
  expect(screen.queryByText("Morning reset")).toBeNull();
  expect(screen.getByText(/Weekly · Monday, Thursday/)).toBeTruthy();
  expect(screen.getByText(/2 open dates/)).toBeTruthy();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "More chore views" }),
    "all",
  );
  expect(screen.getByText("One-off")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Routine stacks" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Pack bag" })).toBeTruthy();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "More chore views" }),
    "routines",
  );
  expect(screen.getByRole("combobox", { name: "Routine range" })).toHaveValue(
    "all",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Routine range" }),
    "today",
  );
  expect(
    screen.getByRole("combobox", { name: "More chore views" }),
  ).toHaveValue("routines");
});
it("keeps profile-only steps disabled and avoids parent controls for a teen's other member", async () => {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const profile = row("Email-free step", {
    routine: "Profile routine",
    assigned_to: null as never,
    assigned_member_id: "profile",
    routine_stack_id: "profile-stack",
  });
  mount(
    [
      profile,
      row("Other member step", {
        routine: "Someone else's routine",
        assigned_to: "other",
        routine_stack_id: "other-stack",
      }),
    ],
    "en",
    "teen",
  );
  expect(
    screen.getByRole("checkbox", { name: "Email-free step" }),
  ).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("checkbox", { name: "Email-free step" }));
  expect(
    screen.queryByRole("button", { name: "Complete Other member step" }),
  ).toBeNull();
  expect(
    screen.queryByRole("link", { name: "Edit Other member step" }),
  ).toBeNull();
  expect((global.fetch as jest.Mock).mock.calls).toHaveLength(0);
});
it("localizes the overview and embedded routine controls without translating household names", () => {
  mount(undefined, "es");
  expect(
    screen.getByRole("heading", { name: "Tareas", level: 1 }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Hoy" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("combobox", { name: "Más vistas de tareas" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("checkbox", { name: "Enfocarse en el siguiente paso" }),
  ).toBeTruthy();
  expect(screen.getByText("0 de 2 pasos hechos · 0 revisados")).toBeTruthy();
  expect(screen.getByText("Morning reset")).toBeTruthy();
});
