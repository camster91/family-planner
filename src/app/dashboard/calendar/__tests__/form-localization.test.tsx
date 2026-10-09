/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, useTranslation } from "@/i18n";
import CreateEventPage from "../create/page";
import EditEventPage from "../edit/page";
const mockPush = jest.fn();
let mockEventId: string | null = "ev-1";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () =>
    new URLSearchParams(mockEventId ? `id=${mockEventId}` : ""),
}));
let changeLocale: (locale: "en" | "es") => void;
function LocaleControl() {
  const { locale, setLocale } = useTranslation();
  changeLocale = setLocale;
  return (
    <button onClick={() => setLocale(locale === "en" ? "es" : "en")}>
      Test locale {locale}
    </button>
  );
}
const event = {
  id: "ev-1",
  title: "Fixture {title} 🗓️",
  description: "Fixture description",
  location: "Fixture location",
  start_time: "2026-10-06T19:00:45.123Z",
  end_time: "2026-10-06T20:00:55.456Z",
  source: null,
};
function fetched(row: unknown = event, failure?: string) {
  const mutations: any[] = [];
  global.fetch = jest.fn(async (input, init) => {
    if (String(input) === "/api/auth/me")
      return { ok: true, json: async () => ({ user: { role: "parent" } }) };
    if (init?.method) {
      mutations.push(JSON.parse(init.body));
      return {
        ok: !failure,
        status: failure ? 409 : 200,
        json: async () => (failure ? { error: failure } : { event }),
      };
    }
    return { ok: true, json: async () => ({ event: row }) };
  }) as jest.Mock;
  return mutations;
}
function renderLocale(node: React.ReactNode, locale: "en" | "es" = "es") {
  return render(
    <I18nProvider locale={locale}>
      <LocaleControl />
      {node}
    </I18nProvider>,
  );
}
beforeEach(() => {
  mockEventId = "ev-1";
  mockPush.mockClear();
});
it("localizes real create controls and required-field hints without changing the disabled gate", () => {
  renderLocale(<CreateEventPage />);
  expect(screen.getByRole("heading", { name: "Nuevo evento" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Crear evento" })).toBeDisabled();
  expect(
    screen.getByText("Añade un título y una fecha de inicio primero."),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Título"), {
    target: { value: "Fixture title" },
  });
  expect(screen.getByText("Añade una fecha de inicio primero.")).toBeVisible();
  expect(screen.getByLabelText("Hora de inicio")).toHaveAttribute(
    "type",
    "time",
  );
  expect(screen.getByLabelText("Hora de fin")).toHaveAttribute("type", "time");
});
it("a local validation error changes on a mounted locale switch and keeps the private draft", async () => {
  global.fetch = jest.fn();
  const user = userEvent.setup();
  renderLocale(<CreateEventPage />, "en");
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Fixture {draft} 🗓️" },
  });
  fireEvent.change(document.getElementById("startDate")!, {
    target: { value: "2026-10-06" },
  });
  fireEvent.change(document.getElementById("startTime")!, {
    target: { value: "15:00" },
  });
  fireEvent.change(document.getElementById("endDate")!, {
    target: { value: "2026-10-05" },
  });
  fireEvent.submit(document.querySelector("form")!);
  await screen.findByText(
    "The end must be after the start. Check the end date and time.",
  );
  await user.click(screen.getByRole("button", { name: "Test locale en" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "El fin debe ser posterior al inicio. Revisa la fecha y la hora de fin.",
  );
  expect(screen.getByLabelText("Título")).toHaveValue("Fixture {draft} 🗓️");
  expect(global.fetch).not.toHaveBeenCalled();
});
it("mounted edit/delete dialog translation preserves fetched instants, private text and original ID", async () => {
  const mutations = fetched(),
    user = userEvent.setup();
  renderLocale(<EditEventPage />, "en");
  await screen.findByDisplayValue(event.title);
  await user.click(await screen.findByRole("button", { name: "Delete event" }));
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  act(() => changeLocale("es"));
  expect(
    screen.getByRole("dialog", { name: "¿Eliminar este evento?" }),
  ).toBeVisible();
  expect(
    screen.getByText(
      `“${event.title}” se eliminará del calendario familiar para todos.`,
    ),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.getByLabelText("Título")).toHaveValue(event.title);
  expect(screen.getByLabelText("Descripción")).toHaveValue(event.description);
  expect(screen.getByLabelText("Ubicación")).toHaveValue(event.location);
  await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(mutations).toHaveLength(1));
  expect(mutations[0]).toMatchObject({
    eventId: event.id,
    title: event.title,
    start_time: event.start_time,
    end_time: event.end_time,
  });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
it("imported source and event title are verbatim while read-only explanation and back link localize", async () => {
  fetched({ ...event, source: { name: "Fixture {source} 🗓️" } });
  renderLocale(<EditEventPage />);
  expect(
    await screen.findByRole("heading", { name: event.title }),
  ).toBeVisible();
  expect(screen.getByText("De Fixture {source} 🗓️")).toBeVisible();
  expect(
    screen.getByText(
      "Este evento viene de un calendario suscrito y es de solo lectura aquí. Cámbialo en el calendario original y se actualizará en la próxima sincronización.",
    ),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Volver al calendario" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Guardar cambios" }),
  ).not.toBeInTheDocument();
});
it("no-record empty state uses the selected language and sends no event request", async () => {
  mockEventId = null;
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ user: { role: "parent" } }),
  })) as jest.Mock;
  renderLocale(<EditEventPage />);
  expect(
    screen.getByRole("heading", { name: "Ningún evento seleccionado" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Volver al calendario" }),
  ).toBeVisible();
  await act(async () => {
    await Promise.resolve();
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("an unknown server error remains verbatim across mounted language changes", async () => {
  const raw = "Fixture provider error {private} 🗓️",
    user = userEvent.setup();
  fetched(event, raw);
  renderLocale(<EditEventPage />);
  await screen.findByDisplayValue(event.title);
  await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(raw);
  await user.click(screen.getByRole("button", { name: "Test locale es" }));
  expect(screen.getByRole("alert")).toHaveTextContent(raw);
  expect(screen.getByLabelText("Title")).toHaveValue(event.title);
});

it("a mounted locale switch preserves the pending event load without restarting it", async () => {
  let finish!: (value: unknown) => void;
  global.fetch = jest.fn((input) =>
    String(input) === "/api/auth/me"
      ? Promise.resolve({
          ok: true,
          json: async () => ({ user: { role: "parent" } }),
        })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  ) as jest.Mock;
  renderLocale(<EditEventPage />);
  expect(screen.getByText("Cargando...")).toBeVisible();
  act(() => changeLocale("en"));
  expect(screen.getByText("Loading...")).toBeVisible();
  expect(global.fetch).toHaveBeenCalledTimes(2);
  await act(async () => finish({ ok: true, json: async () => ({ event }) }));
  expect(await screen.findByDisplayValue(event.title)).toBeVisible();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
it("a locale switch retains pending delete and local recovery state without another DELETE", async () => {
  let finish!: (value: unknown) => void;
  const deletes: any[] = [];
  global.fetch = jest.fn((input, init) => {
    if (String(input) === "/api/auth/me")
      return Promise.resolve({
        ok: true,
        json: async () => ({ user: { role: "parent" } }),
      });
    if (init?.method === "DELETE") {
      deletes.push(JSON.parse(init.body));
      return new Promise((resolve) => {
        finish = resolve;
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({ event }) });
  }) as jest.Mock;
  const user = userEvent.setup();
  renderLocale(<EditEventPage />);
  await screen.findByDisplayValue(event.title);
  await user.click(
    await screen.findByRole("button", { name: "Eliminar evento" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Eliminar" }),
  );
  expect(screen.getByRole("button", { name: "Eliminando…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
  act(() => changeLocale("en"));
  expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(deletes).toEqual([{ eventId: event.id }]);
  await act(async () =>
    finish({ ok: false, status: 500, json: async () => ({}) }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not delete the event. Try again.",
  );
  act(() => changeLocale("es"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "No se pudo eliminar el evento. Inténtalo de nuevo.",
  );
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Eliminar evento" })).toHaveFocus();
  expect(screen.getByLabelText("Título")).toHaveValue(event.title);
  expect(deletes).toEqual([{ eventId: event.id }]);
  expect(mockPush).not.toHaveBeenCalled();
});
it("a loaded 404 error changes locale without another event request or enabled stale save", async () => {
  global.fetch = jest.fn(async (input) =>
    String(input) === "/api/auth/me"
      ? { ok: true, json: async () => ({ user: { role: "parent" } }) }
      : { ok: false, status: 404 },
  ) as jest.Mock;
  renderLocale(<EditEventPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Evento no encontrado",
  );
  expect(
    screen.getByRole("button", { name: "Guardar cambios" }),
  ).toBeDisabled();
  act(() => changeLocale("en"));
  expect(screen.getByRole("alert")).toHaveTextContent("Event not found");
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
