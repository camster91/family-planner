/** @jest-environment jsdom */
import * as React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { I18nProvider, useTranslation } from "@/i18n";
import { CalendarPlanner } from "../CalendarPlanner";
import { ImportEventsDialog } from "../ImportEventsDialog";
jest.mock("../calendar-planner.module.css", () => ({}));
const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, refresh: jest.fn() }),
}));
let changeLocale: (locale: "en" | "es") => void;
function Control() {
  const { setLocale } = useTranslation();
  changeLocale = setLocale;
  return null;
}
function localized(node: React.ReactNode, locale: "en" | "es" = "es") {
  return render(
    <I18nProvider locale={locale}>
      <Control />
      {node}
    </I18nProvider>,
  );
}
const event = {
  id: "fixture-event",
  title: "Fixture {title} 🗓️",
  location: "Fixture location",
  description: "Fixture description",
  start_time: "2026-01-05T09:00:45.123Z",
  end_time: "2026-01-05T11:00:55.456Z",
  event_type: "other",
  source: { name: "Fixture {source}", color: null },
  source_subscription_id: "fixture-source",
};
beforeEach(() => {
  mockReplace.mockClear();
  window.matchMedia = jest.fn().mockReturnValue({
    matches: true,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  });
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? {
            subscriptions: [
              { id: "fixture-source", name: "Fixture {source}", color: null },
            ],
          }
        : { events: [event], hasMore: false, nextCursor: null },
  })) as jest.Mock;
});
it("translates real planner view/source controls while keeping private event and source text", async () => {
  localized(<CalendarPlanner initialDate="2026-01-05" initialView="agenda" />);
  await screen.findByRole("button", { name: /Fixture \{title\}/ });
  expect(
    screen.getByRole("navigation", { name: "Vista del calendario" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Día" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Semana" })).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Origen del calendario" }),
  ).toBeVisible();
  expect(screen.getByRole("option", { name: "Fixture {source}" })).toHaveValue(
    "ics:fixture-source",
  );
});
it("a mounted planner language change keeps source/date/view, selected detail, focus and read count", async () => {
  localized(
    <CalendarPlanner initialDate="2026-01-05" initialView="agenda" />,
    "en",
  );
  const card = await screen.findByRole("button", { name: /Fixture \{title\}/ });
  fireEvent.change(screen.getByRole("combobox", { name: "Calendar source" }), {
    target: { value: "ics:fixture-source" },
  });
  fireEvent.click(card);
  const close = screen.getByRole("button", { name: "Close details" });
  close.focus();
  const count = (global.fetch as jest.Mock).mock.calls.length;
  act(() => changeLocale("es"));
  expect(screen.getByRole("button", { name: "Cerrar detalles" })).toHaveFocus();
  expect(
    screen.getByRole("combobox", { name: "Origen del calendario" }),
  ).toHaveValue("ics:fixture-source");
  expect(screen.getByRole("dialog")).toHaveTextContent(event.title);
  expect(
    screen
      .getByRole("dialog")
      .querySelector(`time[datetime="${event.start_time}"]`),
  ).not.toBeNull();
  expect((global.fetch as jest.Mock).mock.calls).toHaveLength(count);
  expect(mockReplace).not.toHaveBeenCalled();
});
it("import input language changes keep the private draft without sending requests", () => {
  localized(
    <ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />,
    "en",
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Text of the email or flyer" }),
    { target: { value: "Fixture {draft} private flyer" } },
  );
  act(() => changeLocale("es"));
  expect(
    screen.getByRole("textbox", { name: "Texto del correo o folleto" }),
  ).toHaveValue("Fixture {draft} private flyer");
  expect(screen.getByRole("button", { name: "Buscar eventos" })).toBeEnabled();
  expect(global.fetch).not.toHaveBeenCalled();
});
it("pending import copy switches language without another read and preserves the eventual raw error", async () => {
  let resolve!: (value: unknown) => void;
  global.fetch = jest.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  ) as jest.Mock;
  localized(
    <ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />,
    "en",
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "Text of the email or flyer" }),
    { target: { value: "Fixture input" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Find events" }));
  act(() => changeLocale("es"));
  expect(screen.getByRole("status")).toHaveTextContent("Buscando eventos…");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({
      ok: false,
      status: 400,
      json: async () => ({ error: "Fixture raw {error} from provider" }),
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Fixture raw {error} from provider",
  );
  act(() => changeLocale("en"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Fixture raw {error} from provider",
  );
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

import { ImportUndoToast, SourceBadge } from "../CalendarPageClient";
import { UpdatedLine, SyncNotice } from "@/components/fridge/sync-status";
const suggestion = {
  title: "Fixture {draft} 🗓️",
  start: "2026-10-09T15:30:00-04:00",
  end: "2026-10-09T17:00:00-04:00",
  allDay: false,
  location: "Fixture gym",
  notes: "Fixture {notes}",
  confidence: 0.9,
};
function suggestionResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      suggestions: [suggestion],
      timeZone: "America/Toronto",
    }),
  };
}
async function findSuggestion() {
  fireEvent.change(
    screen.getByRole("textbox", { name: "Texto del correo o folleto" }),
    { target: { value: "Fixture flyer" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Buscar eventos" }));
  await screen.findByDisplayValue(suggestion.title);
}
it("review validation changes language while private fields, choices and requests are retained", async () => {
  global.fetch = jest.fn(async () => suggestionResponse()) as jest.Mock;
  localized(<ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />);
  await findSuggestion();
  expect(screen.getByTestId("import-confidence")).toHaveTextContent("Probable");
  expect(screen.getByLabelText("Ubicación")).toHaveValue(suggestion.location);
  fireEvent.change(screen.getByLabelText("Título"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("import-add"));
  expect(screen.getByTestId("import-card-error")).toHaveTextContent(
    "Introduce un título.",
  );
  act(() => changeLocale("en"));
  expect(screen.getByTestId("import-card-error")).toHaveTextContent(
    "Enter a title.",
  );
  expect(screen.getByLabelText("Notes")).toHaveValue(suggestion.notes);
  expect(screen.getByLabelText("Starts")).toHaveValue("15:30");
  expect(screen.getByRole("checkbox", { name: "Add event 1" })).toBeChecked();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("a lost commit response and locale switch reuse the exact reviewed batch and idempotency key", async () => {
  const commits: RequestInit[] = [];
  let resolve!: (value: unknown) => void;
  const done = jest.fn();
  global.fetch = jest.fn(async (url, init) => {
    if (!String(url).endsWith("/commit")) return suggestionResponse();
    commits.push(init!);
    if (commits.length === 1) throw new Error("Fixture lost response");
    return new Promise((finish) => {
      resolve = finish;
    });
  }) as jest.Mock;
  localized(<ImportEventsDialog onClose={jest.fn()} onDone={done} />);
  await findSuggestion();
  fireEvent.click(screen.getByTestId("import-add"));
  await screen.findByRole("alert");
  act(() => changeLocale("en"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Couldn't reach the calendar.",
  );
  fireEvent.click(screen.getByTestId("import-add"));
  await act(async () => {
    await Promise.resolve();
  });
  act(() => changeLocale("es"));
  expect(screen.getByTestId("import-add")).toHaveTextContent("Añadiendo…");
  expect(screen.getByTestId("import-add")).toBeDisabled();
  expect(commits).toHaveLength(2);
  expect(commits[1].body).toBe(commits[0].body);
  expect(commits[1].headers).toEqual(commits[0].headers);
  expect(
    (commits[0].headers as Record<string, string>)["Idempotency-Key"],
  ).toEqual(expect.any(String));
  const body = JSON.parse(String(commits[0].body));
  expect(body.events[0]).toMatchObject({
    title: suggestion.title,
    location: suggestion.location,
    description: suggestion.notes,
    start_time: "2026-10-09T19:30:00.000Z",
  });
  await act(async () =>
    resolve({
      ok: true,
      status: 201,
      json: async () => ({
        count: 1,
        eventIds: ["fixture-added"],
        undoToken: "fixture-token",
        undoExpiresAt: new Date(Date.now() + 600000).toISOString(),
      }),
    }),
  );
  expect(done).toHaveBeenCalledTimes(1);
  expect(global.fetch).toHaveBeenCalledTimes(3);
});
it("undo stays bound to its token while pending language changes preserve one request and raw errors", async () => {
  let resolve!: (value: unknown) => void;
  global.fetch = jest.fn(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  ) as jest.Mock;
  localized(
    <ImportUndoToast
      result={{
        count: 2,
        eventIds: ["fixture-a", "fixture-b"],
        undoToken: "fixture-token",
        undoExpiresAt: new Date(Date.now() + 600000).toISOString(),
      }}
      addedAt={Date.now()}
      onDismiss={jest.fn()}
      onUndone={jest.fn()}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "Se añadieron 2 eventos",
  );
  fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
  act(() => changeLocale("en"));
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)).toEqual(
    { token: "fixture-token" },
  );
  await act(async () =>
    resolve({
      ok: false,
      status: 500,
      json: async () => ({
        error: { message: "Fixture raw {title} undo error" },
      }),
    }),
  );
  act(() => changeLocale("es"));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Fixture raw {title} undo error",
  );
  expect(screen.getByRole("button", { name: "Deshacer" })).toBeEnabled();
});
it("source badge parameters remain verbatim under expanded Spanish presentation", () => {
  render(
    <I18nProvider locale="es" pseudolocalize>
      <SourceBadge name="Fixture {source} 🗓️" color={null} />
    </I18nProvider>,
  );
  const badge = screen.getByText(/Fixture \{source\}/);
  expect(badge.textContent).toContain("Fixture {source} 🗓️");
  expect(badge.parentElement?.title).toContain("Fixture {source} 🗓️");
});
for (const [age, expected] of [
  [-1000, "ahora mismo"],
  [0, "ahora mismo"],
  [59000, "ahora mismo"],
  [60000, "hace 1 min"],
  [3599999, "hace 59 min"],
  [3600000, "hace 1 hora"],
  [7200000, "hace 2 horas"],
  [86400000, "ayer"],
  [172800000, "hace 2 días"],
] as const)
  it(`shared visible sync keeps existing age semantics at ${age}ms`, () => {
    localized(<UpdatedLine now={200000000} lastSyncAt={200000000 - age} />);
    expect(screen.getByTestId("board-updated")).toHaveTextContent(
      `Actualizado ${expected}`,
    );
    expect(screen.getByTestId("board-updated")).not.toHaveAttribute(
      "aria-live",
    );
  });
it("shared offline notices switch language without changing age or duplicating the app banner", () => {
  localized(
    <SyncNotice
      lastSyncAt={0}
      now={180000}
      online={false}
      what="calendar"
      appBanner
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "El calendario se actualiza cuando vuelve la conexión.",
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("Sin conexión.");
  act(() => changeLocale("en"));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Showing what was here 3 min ago. The calendar refreshes when the connection returns.",
  );
});
it("the parent-only local detail edit action is translated without exposing it on imported events", async () => {
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      String(url).includes("subscriptions")
        ? { subscriptions: [] }
        : {
            events: [{ ...event, source: null, source_subscription_id: null }],
            hasMore: false,
            nextCursor: null,
          },
  })) as jest.Mock;
  localized(
    <CalendarPlanner
      initialDate="2026-01-05"
      initialView="agenda"
      canEditEvents
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /Fixture \{title\}/ }),
  );
  expect(screen.getByRole("link", { name: "Editar evento" })).toHaveAttribute(
    "href",
    "/dashboard/calendar/edit?id=fixture-event",
  );
});
it("the import dialog's shared close control updates language without moving input focus", () => {
  localized(
    <ImportEventsDialog onClose={jest.fn()} onDone={jest.fn()} />,
    "en",
  );
  const input = screen.getByRole("textbox", {
    name: "Text of the email or flyer",
  });
  input.focus();
  act(() => changeLocale("es"));
  expect(screen.getByRole("button", { name: "Cerrar" })).toBeVisible();
  expect(
    screen.getByRole("textbox", { name: "Texto del correo o folleto" }),
  ).toHaveFocus();
});
