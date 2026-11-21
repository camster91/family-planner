/** @jest-environment jsdom */
// "All day" on the event forms: what shows, what hides and what is sent.
import { calendarReadOwnerHeaders } from "@/__tests__/helpers/calendar-read-owner";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { I18nProvider } from "@/i18n";
import CreateEventForm from "../create/CreateEventForm";
import EditEventForm from "../edit/EditEventForm";
import { allDayDays } from "@/lib/all-day";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams("id=trip"),
}));
// Local wall-clock instants, as the forms build them, so the test holds in any zone.
const local = (day: string, time: string) => new Date(`${day}T${time}`).toISOString();
const saved = {
  id: "trip", title: "Camping", start_time: local("2099-07-03", "00:00"), end_time: local("2099-07-05", "23:59"), event_type: "family",
  all_day: true as boolean | undefined, source: null, source_connection_id: null, participants: [], series_id: null, repeat: null,
};
let event: typeof saved;
const sent = () => (global.fetch as jest.Mock).mock.calls.filter(([, o]) => o?.method).map(([, o]) => ({ method: o.method as string, body: JSON.parse(String(o.body)) }));
beforeEach(() => {
  event = { ...saved };
  localStorage.clear();
  window.matchMedia = jest.fn().mockReturnValue({ matches: true });
  global.fetch = jest.fn(async (url, options) => {
    if (String(url) === "/api/auth/me") return { ok: true, headers: calendarReadOwnerHeaders(), json: async () => ({ user: { role: "parent" } }) };
    if (options?.method) return { ok: true, json: async () => ({ event, success: true }) };
    return { ok: true, headers: calendarReadOwnerHeaders(), json: async () => ({ event }) };
  }) as jest.Mock;
});
const submit = (name: string | RegExp) => fireEvent.submit(screen.getByRole("button", { name }).closest("form")!);
const allDaySwitch = () => screen.getByRole("switch", { name: "All day" });

describe("All day on the new event form", () => {
  it("is off at first, with the time and duration fields showing", () => {
    render(<CreateEventForm inSheet />);
    expect(allDaySwitch()).toHaveAttribute("aria-checked", "false");
    expect(allDaySwitch()).toHaveAccessibleDescription("No start or end time.");
    // A 44px target: the switch is a real button with the shared minimum size.
    expect(allDaySwitch().className).toContain("min-h-[44px]");
    expect(allDaySwitch().className).toContain("min-w-[44px]");
    expect(screen.getByLabelText("Start time")).toBeInTheDocument();
    expect(screen.getByLabelText("Duration")).toBeInTheDocument();
    expect(screen.queryByLabelText("Ends on (optional)")).not.toBeInTheDocument();
  });

  it("hides the time and duration, keeps the date, and sends the whole day with all_day", async () => {
    render(<CreateEventForm inSheet />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Field trip" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2099-10-05" } });
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "09:30" } });
    fireEvent.click(allDaySwitch());
    expect(allDaySwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText("Start time")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duration")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Day")).toHaveValue("2099-10-05");
    expect(document.getElementById("endTime")).toBeDisabled();
    submit("Create Event");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toEqual({ method: "POST", body: {
      title: "Field trip", description: null, location: null, all_day: true,
      start_time: local("2099-10-05", "00:00"), end_time: local("2099-10-05", "23:59"),
    } });
  });

  it("sends a longer all-day event through its end day and refuses an end day before the first", async () => {
    render(<CreateEventForm inSheet />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Camping" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2099-07-03" } });
    fireEvent.click(allDaySwitch());
    const last = screen.getByLabelText("Ends on (optional)");
    expect(last).toHaveAttribute("min", "2099-07-03");
    expect(last).toHaveAccessibleDescription("Leave empty for a one-day event.");
    fireEvent.change(last, { target: { value: "2099-07-01" } });
    submit("Create Event");
    expect(await screen.findByText("The end day must be on or after the first day.")).toBeInTheDocument();
    expect(sent()).toHaveLength(0);
    fireEvent.change(last, { target: { value: "2099-07-05" } });
    submit("Create Event");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).toMatchObject({ all_day: true, start_time: local("2099-07-03", "00:00"), end_time: local("2099-07-05", "23:59") });
    expect(allDayDays(sent()[0].body.start_time, sent()[0].body.end_time)).toEqual({ first: "2099-07-03", last: "2099-07-05" });
  });

  it("turning it off again sends an ordinary timed event with no all_day field", async () => {
    render(<CreateEventForm inSheet />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Swim" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2099-10-05" } });
    fireEvent.click(allDaySwitch());
    fireEvent.change(screen.getByLabelText("Ends on (optional)"), { target: { value: "2099-10-07" } });
    fireEvent.click(allDaySwitch());
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "16:00" } });
    submit("Create Event");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).not.toHaveProperty("all_day");
    // The end day picked for the all-day event is not carried into the timed one.
    expect(sent()[0].body).toMatchObject({ start_time: local("2099-10-05", "16:00"), end_time: local("2099-10-05", "16:00") });
  });

  it("repeats an all-day event with the same request shape plus the repeat", async () => {
    render(<CreateEventForm inSheet repeatSupported />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Recycling" } });
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "2099-10-05" } });
    fireEvent.click(allDaySwitch());
    fireEvent.change(screen.getByLabelText("Repeat"), { target: { value: "week" } });
    submit("Create Event");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).toMatchObject({ all_day: true, repeat: { every: "week" }, start_time: local("2099-10-05", "00:00") });
  });

  it("says it in Spanish", () => {
    render(<I18nProvider locale="es"><CreateEventForm inSheet /></I18nProvider>);
    const control = screen.getByRole("switch", { name: "Todo el día" });
    expect(control).toHaveAccessibleDescription("Sin hora de inicio ni de fin.");
    fireEvent.click(control);
    expect(screen.getByLabelText("Día")).toBeInTheDocument();
    expect(screen.getByLabelText("Termina el (opcional)")).toBeInTheDocument();
  });
});

describe("All day on the edit form", () => {
  it("opens an all-day event with the switch on, its days and no times", async () => {
    render(<EditEventForm inSheet />);
    expect(await screen.findByRole("switch", { name: "All day" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Day")).toHaveValue("2099-07-03");
    expect(screen.getByLabelText("Ends on (optional)")).toHaveValue("2099-07-05");
    expect(screen.queryByLabelText("Start time")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duration")).not.toBeInTheDocument();
  });

  it("saves it as all day, and a one-day event has an empty end day", async () => {
    event = { ...saved, end_time: local("2099-07-03", "23:59") };
    render(<EditEventForm inSheet />);
    await screen.findByRole("switch", { name: "All day" });
    expect(screen.getByLabelText("Ends on (optional)")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2099-07-04" } });
    submit("Save Changes");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]).toMatchObject({ method: "PATCH", body: { eventId: "trip", all_day: true, start_time: local("2099-07-04", "00:00"), end_time: local("2099-07-04", "23:59") } });
  });

  it("turning it off sends all_day false with the chosen time", async () => {
    render(<EditEventForm inSheet />);
    fireEvent.click(await screen.findByRole("switch", { name: "All day" }));
    expect(screen.getByLabelText("Duration")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "10:00" } });
    submit("Save Changes");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).toMatchObject({ all_day: false, start_time: local("2099-07-03", "10:00"), end_time: local("2099-07-03", "10:00") });
  });

  it("a timed event stays the same request as before: no all_day field", async () => {
    event = { ...saved, all_day: undefined, start_time: local("2099-07-03", "15:00"), end_time: local("2099-07-03", "16:00") };
    render(<EditEventForm inSheet />);
    expect(await screen.findByRole("switch", { name: "All day" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Start time")).toHaveValue("15:00");
    submit("Save Changes");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0].body).not.toHaveProperty("all_day");
  });
});
