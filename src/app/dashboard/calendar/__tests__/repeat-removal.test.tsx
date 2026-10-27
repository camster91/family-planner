/** @jest-environment jsdom */
/** Authored/unrun: no server, account, event, provider or browser run. */
import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import EditEventPage from "../edit/page";
const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("id=event-a"),
}));
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; push.mockClear(); });
function setup(rule = "FREQ=BAD", conflict = false) {
  const patches: Array<Record<string, unknown>> = [];
  global.fetch = jest.fn(async (input, init) => {
    if (String(input) === "/api/auth/me")
      return { ok: true, json: async () => ({ user: { role: "parent" } }) } as Response;
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return { ok: !conflict, json: async () => conflict
        ? { error: "Repeat changed", code: "EVENT_RECURRENCE_CHANGED" } : { event: { id: "event-a" } } } as Response;
    }
    return { ok: true, json: async () => ({ event: { id: "event-a", title: "Fixture title",
      description: null, location: null, source: null, recurrence: rule,
      start_time: "2026-10-24T17:00:45.123Z", end_time: "2026-10-24T18:00:55.456Z" } }) } as Response;
  }) as typeof fetch;
  return patches;
}
it("preserves an unsupported rule when only the title changes", async () => {
  const patches = setup(); render(<EditEventPage />);
  fireEvent.change(await screen.findByDisplayValue("Fixture title"), { target: { value: "Edited title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await screen.findByDisplayValue("Edited title");
  expect(patches).toHaveLength(1);
  expect(patches[0]).not.toHaveProperty("recurrence"); expect(patches[0]).not.toHaveProperty("expected_recurrence");
});
it("requires an explicit choice and save before removing the exact reviewed rule", async () => {
  const patches = setup(); render(<EditEventPage />);
  await screen.findByDisplayValue("Fixture title");
  fireEvent.click(screen.getByText("Repeating event"));
  fireEvent.click(await screen.findByRole("button", { name: "Stop repeating" }));
  expect(patches).toHaveLength(0);
  expect(screen.getByText(/Saving will remove this event/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(patches[0]).toMatchObject({ recurrence: null, expected_recurrence: "FREQ=BAD" });
});
it("lets the parent cancel the removal choice before saving", async () => {
  const patches = setup(); render(<EditEventPage />);
  await screen.findByDisplayValue("Fixture title");
  fireEvent.click(screen.getByText("Repeating event"));
  fireEvent.click(await screen.findByRole("button", { name: "Stop repeating" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep the saved repeat rule" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(patches[0]).not.toHaveProperty("recurrence");
});
it("retains the draft and reports a changed-rule conflict without navigating or resending", async () => {
  const patches = setup("FREQ=BAD", true);
  render(<I18nProvider locale="es" persistLocale={false}><EditEventPage /></I18nProvider>);
  const title = await screen.findByDisplayValue("Fixture title");
  fireEvent.change(title, { target: { value: "Unsaved title" } });
  fireEvent.click(screen.getByText("Evento repetido"));
  fireEvent.click(await screen.findByRole("button", { name: "Dejar de repetir" }));
  fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await screen.findByText(/La regla guardada cambió/);
  expect(screen.getByDisplayValue("Unsaved title")).toBeTruthy();
  expect(patches).toHaveLength(1); expect(push).not.toHaveBeenCalled();
});
