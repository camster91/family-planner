/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChoresContent from "../ChoresContent";
import { I18nProvider, useTranslation } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => false,
}));
type TestChore = ComponentProps<typeof ChoresContent>["chores"][number];
const chore: TestChore = {
  id: "owned-occurrence",
  family_id: "fixture",
  title: "Pack lunch 原",
  points: 0,
  assigned_to: "adult",
  due_date: "2026-10-09",
  status: "pending" as const,
  frequency: "once" as const,
  difficulty: "easy" as const,
  created_at: "2026-10-01",
  assignee: { name: "Alex 原" },
  creator: { name: "Alex 原" },
};
function SwitchLocale() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("en")}>Switch to English</button>;
}
function mount(chores = [chore], historyCursor: string | null = null) {
  render(
    <I18nProvider locale="es">
      <ToastProvider>
        <SwitchLocale />
        <ChoresContent
          chores={chores}
          familyMembers={[
            { id: "adult", name: "Alex 原", role: "parent" },
            { id: "child", name: "Casey 原", role: "child" },
          ]}
          currentUserId="adult"
          userRole="parent"
          historyCursor={historyCursor}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}
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
const user = () => userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
const opener = () =>
  screen.getByRole("button", { name: "Más acciones para “Pack lunch 原”" });

it("keeps localized dates and routine metadata beside verbatim household names", async () => {
  const u = user();
  mount([
    {
      ...chore,
      due_date: "2026-10-10",
      routine: "Morning 原",
      routine_order: 3,
      rotation_next_name: "Casey 原",
    },
  ]);
  await u.click(screen.getByRole("button", { name: "Semana" }));
  const disclosure = screen.getByText("Rutinas paso a paso", {
    selector: "summary",
  });
  await u.click(disclosure);
  expect(
    screen.getByRole("checkbox", { name: "Pack lunch 原" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      /Alex 原 · Mañana · Morning 原, paso 3 · Por turnos · siguiente: Casey 原/,
    ),
  ).toBeInTheDocument();
});
it("keeps reassignment selection through a locale change and sends canonical IDs", async () => {
  const u = user();
  mount();
  await u.click(opener());
  const sheet = screen.getByRole("dialog", {
    name: "Más acciones para “Pack lunch 原”",
  });
  for (const name of [
    "Posponer un día",
    "Editar",
    "Reasignar",
    "Marcar como hecha",
    "Cancelar",
  ])
    expect(within(sheet).getByRole("button", { name })).toBeInTheDocument();
  await u.click(within(sheet).getByRole("button", { name: "Reasignar" }));
  const dialog = await screen.findByRole("dialog", { name: "Reasignar tarea" });
  expect(
    within(dialog).getByRole("group", { name: "Asignar a" }),
  ).toBeInTheDocument();
  const child = within(dialog).getByRole("button", {
    name: /Casey 原.*Niño o niña/,
  });
  await u.click(child);
  expect(child).toHaveAttribute("aria-pressed", "true");
  expect(global.fetch).not.toHaveBeenCalled();
  await u.click(screen.getByRole("button", { name: "Switch to English" }));
  const english = screen.getByRole("dialog", { name: "Reassign chore" });
  expect(
    within(english).getByRole("button", { name: /Casey 原.*Child/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await u.click(within(english).getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/chores",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          choreId: "owned-occurrence",
          assigned_to: "child",
        }),
      }),
    ),
  );
  expect(await screen.findByText("Chore reassigned")).toBeInTheDocument();
});
it("snoozes the date-only occurrence using the stored server date and Spanish feedback", async () => {
  const u = user();
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ chore: { due_date: "2026-10-10T00:00:00.000Z" } }),
  });
  mount();
  await u.click(opener());
  await u.click(screen.getByRole("button", { name: "Posponer un día" }));
  await waitFor(() =>
    expect(screen.getByText("Pospuesta un día")).toBeInTheDocument(),
  );
  expect(screen.getByText("Ahora es para mañana.")).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(
    "/api/chores",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        choreId: "owned-occurrence",
        due_date: "2026-10-10",
      }),
    }),
  );
});
it("keeps raw history failures separate from owned localized recovery controls", async () => {
  const u = user();
  mount([{ ...chore, status: "verified" }], "opaque-history-cursor");
  await u.selectOptions(
    screen.getByRole("combobox", { name: "Más vistas de tareas" }),
    "all",
  );
  await u.click(screen.getByRole("button", { name: /Hechas/ }));
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({ error: "Raw server detail 原" }),
  });
  await u.click(screen.getByRole("button", { name: "Cargar más" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No se pudieron cargar más tareas. Raw server detail 原",
    ),
  );
  expect(
    screen.getByRole("button", { name: "Intentar de nuevo" }),
  ).toBeInTheDocument();
  await u.click(screen.getByRole("button", { name: "Switch to English" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn't load more chores. Raw server detail 原",
  );
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain(
    "cursor=opaque-history-cursor",
  );
});

it("localizes selected weekdays and the full Series summary without changing occurrence identities", async () => {
  const u = user();
  const repeated = {
    ...chore,
    title: "Weekly chores 原",
    recurrence_id: "existing-series",
    recurrence_frequency: "weekly" as const,
    recurrence_weekly_days: [1, 4],
  };
  mount([
    { ...repeated, id: "first-date", due_date: "2026-10-10" },
    { ...repeated, id: "second-date", due_date: "2026-10-12" },
  ]);
  await u.click(screen.getByRole("button", { name: "Series" }));
  const summary = screen
    .getByText("Weekly chores 原", { selector: "summary span" })
    .closest("summary")!;
  expect(summary).toHaveTextContent("Semanal · Lunes, Jueves · Alex 原");
  expect(summary).toHaveTextContent(
    "Siguiente: Mañana · 2 fechas pendientes · Desplegar para ver las fechas",
  );
  expect(summary.closest("details")).not.toHaveAttribute("open");
  await u.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  expect(
    screen.getAllByRole("checkbox", { name: "Weekly chores 原" }),
  ).toHaveLength(2);
  expect(global.fetch).not.toHaveBeenCalled();
});
