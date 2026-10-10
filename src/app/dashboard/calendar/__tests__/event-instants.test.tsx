/** @jest-environment jsdom */
import * as React from "react";
import { runInThisContext } from "node:vm";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditEventPage from "../edit/page";
import CreateEventPage from "../create/page";
import { I18nProvider, useTranslation } from "@/i18n";

const mockPush = jest.fn();
let mockEventId = "ev-1";
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(`id=${mockEventId}`),
}));
function LocaleControl() {
  const { locale, setLocale } = useTranslation();
  return (
    <button type="button" onClick={() => setLocale("es")}>
      Switch test locale: {locale}
    </button>
  );
}

const runtimeProcess = runInThisContext("process") as NodeJS.Process;
const originalTZ = runtimeProcess.env.TZ;
beforeAll(() => {
  runtimeProcess.env.TZ = "America/Toronto";
});
afterAll(() => {
  if (originalTZ === undefined) delete runtimeProcess.env.TZ;
  else runtimeProcess.env.TZ = originalTZ;
});
beforeEach(() => {
  mockPush.mockClear();
  mockEventId = "ev-1";
  expect(new Date("2026-11-01T05:30:00Z").getTimezoneOffset()).toBe(240);
  expect(new Date("2026-11-01T06:30:00Z").getTimezoneOffset()).toBe(300);
});
function setup(start: string, end: string) {
  const patches: any[] = [];
  global.fetch = jest.fn(async (input, init) => {
    if (String(input) === "/api/auth/me")
      return { ok: true, json: async () => ({ user: { role: "parent" } }) };
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ success: true }) };
    }
    return {
      ok: true,
      json: async () => ({
        event: {
          id: "ev-1",
          title: "Fixture appointment",
          start_time: start,
          end_time: end,
          description: null,
          location: null,
          source: null,
        },
      }),
    };
  }) as jest.Mock;
  return patches;
}
for (const locale of ["en", "es"] as const) {
  it.each([
    ["first fold", "2026-11-01T05:30:45.123Z", "2026-11-01T05:45:55.456Z"],
    ["second fold", "2026-11-01T06:30:45.123Z", "2026-11-01T06:45:55.456Z"],
    ["cross fold", "2026-11-01T05:30:45.123Z", "2026-11-01T06:15:55.456Z"],
    [
      "ordinary precision",
      "2026-10-06T19:00:45.123Z",
      "2026-10-06T20:00:55.456Z",
    ],
    ["year boundary", "2027-01-01T04:30:45.123Z", "2027-01-01T05:30:55.456Z"],
  ])(
    `preserves exact fetched instants on a ${locale} title-only edit: %s`,
    async (_label, start, end) => {
      const patches = setup(start, end),
        user = userEvent.setup();
      render(
        <I18nProvider locale={locale}>
          <EditEventPage />
        </I18nProvider>,
      );
      const title = await screen.findByDisplayValue("Fixture appointment");
      await user.clear(title);
      await user.type(title, "Updated fixture appointment");
      await user.click(
        screen.getByRole("button", {
          name: locale === "es" ? "Guardar cambios" : "Save Changes",
        }),
      );
      await waitFor(() => expect(patches).toHaveLength(1));
      expect(patches[0]).toMatchObject({
        eventId: "ev-1",
        title: "Updated fixture appointment",
        start_time: start,
        end_time: end,
      });
      expect(mockPush).toHaveBeenCalledWith("/dashboard/calendar");
    },
  );
}
it("a mounted language change preserves original instants and numeric form fields", async () => {
  const start = "2026-11-01T06:30:45.123Z",
    end = "2026-11-01T06:45:55.456Z";
  const patches = setup(start, end),
    user = userEvent.setup();
  render(
    <I18nProvider locale="en">
      <LocaleControl />
      <EditEventPage />
    </I18nProvider>,
  );
  await screen.findByDisplayValue("Fixture appointment");
  await user.click(
    screen.getByRole("button", { name: "Switch test locale: en" }),
  );
  expect(
    screen.getByRole("button", { name: "Switch test locale: es" }),
  ).toBeTruthy();
  expect(
    (screen.getByLabelText("Hora de inicio") as HTMLInputElement).value,
  ).toBe("01:30");
  await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({ start_time: start, end_time: end });
});
it("a nonexistent manual time follows the existing create error path without POST", async () => {
  global.fetch = jest.fn() as jest.Mock;
  render(<CreateEventPage />);
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Fixture appointment" },
  });
  fireEvent.change(document.getElementById("startDate")!, {
    target: { value: "2026-03-08" },
  });
  fireEvent.change(document.getElementById("startTime")!, {
    target: { value: "02:30" },
  });
  // Submit exercises the handler's own validation independently of native min-date validation.
  fireEvent.submit(
    screen.getByRole("button", { name: "Create Event" }).closest("form")!,
  );
  expect(await screen.findByText("Invalid date/time")).toBeTruthy();
  expect(global.fetch).not.toHaveBeenCalled();
});

it("a pending navigation cannot PATCH the new ID with the previous event fields", async () => {
  const patches = setup("2026-11-01T06:30:45.123Z", "2026-11-01T06:45:55.456Z");
  const user = userEvent.setup();
  const fetchFirst = global.fetch;
  global.fetch = jest.fn((input, init) =>
    String(input).includes("id=ev-2")
      ? new Promise<Response>(() => {})
      : fetchFirst(input, init),
  ) as jest.Mock;
  const view = render(<EditEventPage />);
  await screen.findByDisplayValue("Fixture appointment");
  mockEventId = "ev-2";
  view.rerender(<EditEventPage />);
  const save = screen.queryByRole("button", { name: "Save Changes" });
  if (save) await user.click(save);
  expect(patches).toHaveLength(0);
  expect(screen.getByText("Loading...")).toBeTruthy();
});

it("a late previous-event response cannot replace the newly loaded record", async () => {
  const first = {
    id: "ev-1",
    title: "First fixture",
    start_time: "2026-11-01T06:30:45.123Z",
    end_time: "2026-11-01T06:45:55.456Z",
  };
  const second = {
    id: "ev-2",
    title: "Second fixture",
    start_time: "2026-11-01T06:40:15.789Z",
    end_time: "2026-11-01T06:50:20.456Z",
  };
  const patches: any[] = [];
  let resolveFirst!: (value: any) => void;
  const oldResponse = new Promise((resolve) => {
    resolveFirst = resolve;
  });
  global.fetch = jest.fn(async (input, init) => {
    if (String(input) === "/api/auth/me")
      return { ok: true, json: async () => ({ user: { role: "parent" } }) };
    if (init?.method === "PATCH") {
      patches.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({}) };
    }
    if (String(input).includes("id=ev-1")) return oldResponse;
    return { ok: true, json: async () => ({ event: second }) };
  }) as jest.Mock;
  const user = userEvent.setup(),
    view = render(<EditEventPage />);
  await waitFor(() =>
    expect(global.fetch).toHaveBeenCalledWith("/api/events?id=ev-1"),
  );
  mockEventId = "ev-2";
  view.rerender(<EditEventPage />);
  await screen.findByDisplayValue("Second fixture");
  await act(async () => {
    resolveFirst({ ok: true, json: async () => ({ event: first }) });
  });
  expect(screen.getByDisplayValue("Second fixture")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({
    eventId: "ev-2",
    start_time: second.start_time,
    end_time: second.end_time,
  });
});

it("changing one time field preserves the other exact fetched boundary", async () => {
  const start = "2026-10-06T19:00:45.123Z",
    end = "2026-10-06T20:00:55.456Z";
  const patches = setup(start, end),
    user = userEvent.setup();
  render(<EditEventPage />);
  await screen.findByDisplayValue("Fixture appointment");
  const startInput = screen.getByLabelText("Start time");
  fireEvent.change(startInput, { target: { value: "15:30" } });
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({
    start_time: "2026-10-06T19:30:00.000Z",
    end_time: end,
  });
});
it("an unexpected response ID cannot enable Save or Delete for another record", async () => {
  global.fetch = jest.fn(async (input) =>
    String(input) === "/api/auth/me"
      ? { ok: true, json: async () => ({ user: { role: "parent" } }) }
      : {
          ok: true,
          json: async () => ({
            event: {
              id: "different-event",
              title: "Wrong fixture",
              start_time: "2026-11-01T06:30:45.123Z",
              end_time: "2026-11-01T06:45:55.456Z",
            },
          }),
        },
  ) as jest.Mock;
  const error = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  try {
    render(<EditEventPage />);
    await screen.findByText("Failed to load event data");
    expect(screen.queryByDisplayValue("Wrong fixture")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "Save Changes",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Delete event",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (global.fetch as jest.Mock).mock.calls.every(([, init]) => !init?.method),
    ).toBe(true);
  } finally {
    error.mockRestore();
  }
});

it('editing duration preserves the original second-fold start and saves the requested elapsed length', async () => {
 const start = '2026-11-01T06:30:45.123Z'
 const patches = setup(start, '2026-11-01T06:45:55.456Z')
 const user = userEvent.setup()
 render(<EditEventPage />)
 await screen.findByDisplayValue('Fixture appointment')
 await user.selectOptions(screen.getByLabelText('Duration'), '60')
 await user.click(screen.getByRole('button', { name: 'Save Changes' }))
 await waitFor(() => expect(patches).toHaveLength(1))
 expect(patches[0]).toMatchObject({ start_time: start, end_time: '2026-11-01T07:30:45.123Z' })
})
