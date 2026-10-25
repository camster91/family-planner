/** @jest-environment jsdom */
/** Authored/unrun; no real account/calendar/provider. */
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import CalendarFeedReview from "../CalendarFeedReview";
jest.mock("next/link", () => ({ __esModule: true, default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} /> }));
const original = global.fetch;
afterEach(() => { global.fetch = original; });
const reply = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
it("loads only on a tap and links supported recovery to the canonical event editor", async () => {
  global.fetch = jest.fn(async () => reply({ checked: 1, issues: [{ id: "event-a", title: "Fixture title", source: "local" }], nextCursor: null }));
  render(<I18nProvider locale="en" persistLocale={false}><CalendarFeedReview scope="family-a" /></I18nProvider>);
  expect(global.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Review repeating events" }));
  const link = await screen.findByRole("link", { name: "Review event" });
  expect(link.getAttribute("href")).toBe("/dashboard/calendar/edit?id=event-a");
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
it("keeps old-scope late responses out of a changed household", async () => {
  let finish!: (response: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
  const view = render(<CalendarFeedReview scope="family-a" />);
  fireEvent.click(screen.getByRole("button", { name: "Review repeating events" }));
  await act(async () => { await Promise.resolve(); });
  view.rerender(<CalendarFeedReview scope="family-b" />);
  await act(async () => { finish(reply({ checked: 1, issues: [{ id: "event-a", title: "Previous household fixture", source: "local" }], nextCursor: null })); });
  expect(screen.queryByText("Previous household fixture")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows Spanish review chrome and keeps authored event titles literal", async () => {
  global.fetch = jest.fn(async () => reply({ checked: 1, issues: [{ id: "event-a", title: "Author's title", source: "connected" }], nextCursor: null }));
  render(<I18nProvider locale="es" persistLocale={false}><CalendarFeedReview scope="family-a" /></I18nProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Revisar eventos repetidos" }));
  const link = await screen.findByRole("link", { name: "Revisar calendario de origen" });
  expect(link.getAttribute("href")).toBe("/dashboard/settings#calendar-sync");
  expect(screen.getByText("Author's title")).toBeTruthy();
});
