/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import NotificationPreferences from "../NotificationPreferences";
import LazyNotificationPreferences from "../LazyNotificationPreferences";
const mockLoad = jest.fn();
jest.mock("../load-notification-preferences", () => ({
  loadNotificationPreferences: () => mockLoad(),
}));
import {
  NotificationPreferencesLoading,
  NotificationPreferencesFailure,
} from "../NotificationPreferencesStatus";
const prefs = { chores: true, events: true, messages: true };
const quiet = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timeZone: "America/Toronto",
};
const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;
let change: (language: "en" | "es") => void;
function Control() {
  const { setLocale } = useTranslation();
  change = setLocale;
  return null;
}
function mounted(node: React.ReactNode, locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <Control />
      {node}
    </I18nProvider>,
  );
}
beforeEach(() =>
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => true,
  }),
);
it("preserves optimistic category request, quiet draft and focus while late success adopts current language", async () => {
  let resolve!: (v: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  global.fetch = jest.fn((_: unknown, init?: RequestInit) =>
    init?.method === "PATCH"
      ? pending
      : Promise.resolve(ok({ preferences: prefs, quietHours: quiet })),
  ) as unknown as typeof fetch;
  mounted(<NotificationPreferences />);
  const chores = await screen.findByRole("switch", {
    name: "Chores and rewards",
  });
  const from = screen.getByLabelText("Quiet from") as HTMLInputElement;
  fireEvent.change(from, { target: { value: "21:30" } });
  from.focus();
  fireEvent.click(chores);
  const request = (fetch as jest.Mock).mock.calls[1][1];
  expect(JSON.parse(request.body)).toEqual({ chores: false });
  expect(request.headers["Idempotency-Key"]).toBeTruthy();
  act(() => change("es"));
  expect(screen.getByRole("switch", { name: "Tareas y recompensas" })).toBe(
    chores,
  );
  expect(chores).toBeDisabled();
  expect(chores).toHaveAttribute("aria-checked", "false");
  expect(from).toHaveValue("21:30");
  expect(from).toHaveFocus();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolve(ok({ preferences: { ...prefs, chores: false } })),
  );
  expect(screen.getByText("Tareas y recompensas: desactivado.")).toBeVisible();
  expect(chores).toBeEnabled();
  act(() => change("en"));
  expect(screen.getByText("Chores and rewards: off.")).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("keeps independent pending failure rollback and presents it in current language", async () => {
  let resolve!: (v: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  global.fetch = jest.fn((_: unknown, init?: RequestInit) =>
    init?.method === "PATCH"
      ? pending
      : Promise.resolve(ok({ preferences: prefs })),
  ) as unknown as typeof fetch;
  mounted(<NotificationPreferences />);
  const messages = await screen.findByRole("switch", {
    name: "Family messages",
  });
  fireEvent.click(messages);
  act(() => change("es"));
  await act(async () => resolve({ ok: false, status: 500 } as Response));
  expect(messages).toHaveAttribute("aria-checked", "true");
  expect(messages).toBeEnabled();
  expect(
    screen.getByText(
      "No se pudo guardar «Mensajes de la familia». Se ha restablecido a activado. Inténtalo de nuevo.",
    ),
  ).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("localizes validation without saving or changing the raw quiet draft", async () => {
  global.fetch = jest.fn(() =>
    Promise.resolve(ok({ preferences: prefs, quietHours: quiet })),
  ) as unknown as typeof fetch;
  mounted(<NotificationPreferences />, "es");
  await waitFor(() => expect(screen.getByTestId("quiet-hours")).toBeVisible());
  const inputs = screen.getByTestId("quiet-hours").querySelectorAll("input");
  fireEvent.change(inputs[1], { target: { value: "22:00" } });
  fireEvent.click(screen.getByTestId("quiet-hours").querySelector("button")!);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Las horas de inicio y fin deben ser distintas.",
  );
  expect(inputs[1]).toHaveValue("22:00");
  expect(fetch).toHaveBeenCalledTimes(1);
  act(() => change("en"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "The start and end times must be different.",
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("localizes shared module/API loading and retry without triggering retry on language change", () => {
  const retry = jest.fn();
  mounted(
    <>
      <NotificationPreferencesLoading />
      <NotificationPreferencesFailure onRetry={retry} />
    </>,
    "es",
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Cargando tus ajustes de notificaciones…",
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No se pudieron cargar tus ajustes de notificaciones.",
  );
  const button = screen.getByRole("button", { name: "Intentar de nuevo" });
  button.focus();
  act(() => change("en"));
  expect(button).toHaveFocus();
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
});

it("preserves pending summary opt-in and relocalizes late saved feedback", async () => {
  let resolve!: (v: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  global.fetch = jest.fn((_: unknown, init?: RequestInit) =>
    init?.method === "PATCH"
      ? pending
      : Promise.resolve(
          ok({
            preferences: prefs,
            morningSummary: { enabled: false, timeZone: null },
          }),
        ),
  ) as unknown as typeof fetch;
  mounted(<NotificationPreferences />);
  const summary = await screen.findByRole("switch", {
    name: "Morning summary",
  });
  fireEvent.click(summary);
  const request = (fetch as jest.Mock).mock.calls[1][1];
  const body = JSON.parse(request.body);
  expect(body).toEqual({
    morningSummary: {
      enabled: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  expect(request.headers["Idempotency-Key"]).toBeTruthy();
  act(() => change("es"));
  expect(screen.getByRole("switch", { name: "Resumen matutino" })).toBe(
    summary,
  );
  expect(summary).toBeDisabled();
  expect(summary).toHaveAttribute("aria-checked", "true");
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => resolve(ok({ morningSummary: body.morningSummary })));
  expect(screen.getByText("Resumen matutino: activado.")).toBeVisible();
  expect(summary).toBeEnabled();
  act(() => change("en"));
  expect(screen.getByText("Morning summary: on.")).toBeVisible();
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("preserves pending quiet wall clocks, timezone, key and focus while display adopts current language", async () => {
  let resolve!: (v: Response) => void;
  const pending = new Promise<Response>((r) => (resolve = r));
  global.fetch = jest.fn((_: unknown, init?: RequestInit) =>
    init?.method === "PATCH"
      ? pending
      : Promise.resolve(
          ok({ preferences: prefs, quietHours: { ...quiet, enabled: true } }),
        ),
  ) as unknown as typeof fetch;
  mounted(<NotificationPreferences />);
  const from = await screen.findByLabelText("Quiet from");
  const until = screen.getByLabelText("Quiet until");
  fireEvent.change(from, { target: { value: "21:30" } });
  fireEvent.change(until, { target: { value: "06:45" } });
  const save = screen.getByRole("button", { name: "Save times" });
  save.focus();
  fireEvent.click(save);
  const request = (fetch as jest.Mock).mock.calls[1][1];
  const body = JSON.parse(request.body);
  expect(body).toEqual({
    quietHours: {
      enabled: true,
      start: "21:30",
      end: "06:45",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });
  expect(request.headers["Idempotency-Key"]).toBeTruthy();
  act(() => change("es"));
  expect(from).toHaveValue("21:30");
  expect(until).toHaveValue("06:45");
  expect(save).toHaveFocus();
  expect(save).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => resolve(ok({ quietHours: body.quietHours })));
  expect(
    screen.getByText("Horario de silencio: activado, de 21:30 a 6:45."),
  ).toBeVisible();
  expect(from).toHaveValue("21:30");
  expect(until).toHaveValue("06:45");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("preserves the actual lazy module attempt and retry across mounted language switches", async () => {
  let reject!: (error: Error) => void;
  let resolve!: (component: () => React.JSX.Element) => void;
  mockLoad
    .mockReset()
    .mockImplementationOnce(() => new Promise((_, fail) => (reject = fail)))
    .mockImplementationOnce(() => new Promise((done) => (resolve = done)));
  mounted(<LazyNotificationPreferences />);
  expect(mockLoad).toHaveBeenCalledTimes(1);
  act(() => change("es"));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Cargando tus ajustes de notificaciones…",
  );
  expect(mockLoad).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("isolated optional module failure")));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No se pudieron cargar tus ajustes de notificaciones.",
  );
  const retry = screen.getByRole("button", { name: "Intentar de nuevo" });
  retry.focus();
  act(() => change("en"));
  expect(retry).toHaveFocus();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn't load your notification settings.",
  );
  expect(mockLoad).toHaveBeenCalledTimes(1);
  fireEvent.click(retry);
  expect(mockLoad).toHaveBeenCalledTimes(2);
  act(() => change("es"));
  expect(mockLoad).toHaveBeenCalledTimes(2);
  await act(async () =>
    resolve(() => (
      <button role="switch" aria-checked="false">
        Private fixture switch
      </button>
    )),
  );
  expect(
    screen.getByRole("switch", { name: "Private fixture switch" }),
  ).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(mockLoad).toHaveBeenCalledTimes(2);
});
