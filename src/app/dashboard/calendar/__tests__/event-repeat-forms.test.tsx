/** @jest-environment jsdom */
// Repeating events on the forms: what create, edit and delete send, and that nothing shows when the capability is off.
import { calendarReadOwnerHeaders } from "@/__tests__/helpers/calendar-read-owner";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import CreateEventForm from "../create/CreateEventForm";
import EditEventForm from "../edit/EditEventForm";
import { repeatRequest } from "@/components/calendar/EventRepeatField";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("id=occurrence-3"),
}));
const saved = {
  id: "occurrence-3", title: "Swim", start_time: "2099-12-15T12:00:00Z", end_time: "2099-12-15T13:00:00Z", event_type: "sports",
  source: null, source_connection_id: null, participants: [],
  series_id: "series-1" as string | null, repeat: { every: "week", until: null, time_zone: "America/Toronto" } as unknown,
};
let event: typeof saved;
const sent = () => (global.fetch as jest.Mock).mock.calls.filter(([, o]) => o?.method).map(([, o]) => ({ method: o.method as string, body: JSON.parse(String(o.body)) }));
beforeEach(() => {
  event = { ...saved };
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  global.fetch = jest.fn(async (url, options) => {
    if (String(url) === "/api/auth/me") return { ok: true, headers: calendarReadOwnerHeaders(), json: async () => ({ user: { role: "parent" } }) };
    if (options?.method) return { ok: true, json: async () => ({ event, success: true }) };
    return { ok: true, headers: calendarReadOwnerHeaders(), json: async () => ({ event }) };
  }) as jest.Mock;
});
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function fillCreate() {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Swim" } });
  fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2099-12-15" } });
}
const submit = (name: string | RegExp) => fireEvent.submit(screen.getByRole("button", { name }).closest("form")!);

describe("repeat on the new event form", () => {
  it("is absent and sends no repeat when the capability is off", async () => {
    render(<CreateEventForm inSheet />);
    expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
    fillCreate();
    submit("Create Event");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).not.toHaveProperty("repeat");
  });
  it("sends nothing for \"Does not repeat\" and the rule, last day and zone when chosen", async () => {
    render(<CreateEventForm inSheet repeatSupported />);
    expect(screen.queryByLabelText("Last day (optional)")).not.toBeInTheDocument();
    expect(repeatRequest({ every: "", until: "2099-12-31" })).toBeNull();
    fillCreate();
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "2weeks" } });
    const until = screen.getByLabelText("Last day (optional)");
    expect(until).toHaveAttribute("min", "2099-12-15");
    fireEvent.change(until, { target: { value: "2100-03-01" } });
    submit("Create Event");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({ method: "POST", body: { title: "Swim", repeat: { every: "2weeks", until: "2100-03-01", time_zone: zone } } });
  });
});

describe("a repeating event on the edit form", () => {
  const scope = () => within(screen.getByTestId("event-series-scope"));
  it("offers no choice when off, or for a one-off event", async () => {
    const off = render(<EditEventForm inSheet />);
    await screen.findByDisplayValue("Swim");
    expect(screen.queryByTestId("event-series-scope")).not.toBeInTheDocument();
    off.unmount();
    event = { ...saved, series_id: null, repeat: null };
    render(<EditEventForm inSheet repeatSupported />);
    await screen.findByDisplayValue("Swim");
    expect(screen.queryByTestId("event-series-scope")).not.toBeInTheDocument();
  });
  it("a one-off event can start repeating; a connected or rule-carrying one cannot", async () => {
    event = { ...saved, series_id: null, repeat: null };
    const first = render(<EditEventForm inSheet repeatSupported />);
    await screen.findByDisplayValue("Swim");
    expect(screen.getByLabelText("Repeat")).toHaveValue("");
    submit(/Save/);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).not.toHaveProperty("series_scope");
    first.unmount();
    (global.fetch as jest.Mock).mockClear();
    const second = render(<EditEventForm inSheet repeatSupported />);
    await screen.findByDisplayValue("Swim");
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "month" } });
    submit(/Save/);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).toMatchObject({ eventId: "occurrence-3", series_scope: "following", repeat: { every: "month", until: null, time_zone: zone } });
    second.unmount();
    for (const extra of [{ source_connection_id: "conn-1" }, { recurrence: "FREQ=WEEKLY" }]) {
      event = { ...saved, series_id: null, repeat: null, ...extra } as typeof saved;
      const view = render(<EditEventForm inSheet repeatSupported />);
      await screen.findByDisplayValue("Swim");
      expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
      view.unmount();
    }
  });
  it("defaults to this event and sends no scope", async () => {
    render(<EditEventForm inSheet repeatSupported />);
    await screen.findByTestId("event-series-scope");
    expect(scope().getByLabelText("This event")).toBeChecked();
    expect(screen.queryByLabelText("Repeat")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Swim (goggles)" } });
    submit(/Save/);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({ method: "PATCH", body: { eventId: "occurrence-3", title: "Swim (goggles)" } });
    expect(sent()[0].body).not.toHaveProperty("series_scope");
    expect(sent()[0].body).not.toHaveProperty("repeat");
  });
  it("this and later: sends the scope, and the repeat only when it changed", async () => {
    const first = render(<EditEventForm inSheet repeatSupported />);
    await screen.findByTestId("event-series-scope");
    fireEvent.click(scope().getByLabelText("This and later events"));
    expect(screen.getByLabelText("Repeat")).toHaveValue("week");
    submit(/Save/);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).toMatchObject({ series_scope: "following" });
    expect(sent()[0].body).not.toHaveProperty("repeat");
    first.unmount();
    (global.fetch as jest.Mock).mockClear();
    render(<EditEventForm inSheet repeatSupported />);
    await screen.findByTestId("event-series-scope");
    fireEvent.click(scope().getByLabelText("This and later events"));
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "" } });
    submit(/Save/);
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).toMatchObject({ series_scope: "following", repeat: null });
  });
  it("deletes this one, or this and later", async () => {
    const first = render(<EditEventForm inSheet repeatSupported />);
    await screen.findByTestId("event-series-scope");
    fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete this event" }));
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toEqual({ method: "DELETE", body: { eventId: "occurrence-3" } });
    first.unmount();
    (global.fetch as jest.Mock).mockClear();
    render(<EditEventForm inSheet repeatSupported />);
    await screen.findByTestId("event-series-scope");
    fireEvent.click(screen.getByRole("button", { name: "Delete event" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete this and later events" }));
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toEqual({ method: "DELETE", body: { eventId: "occurrence-3", series_scope: "following" } });
  });
});
