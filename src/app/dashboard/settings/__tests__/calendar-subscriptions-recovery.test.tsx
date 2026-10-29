/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, useTranslation } from "@/i18n";
import CalendarSubscriptionsSection from "../CalendarSubscriptionsSection";
import { calendarSubscriptionFeedback } from "@/i18n/calendar-subscription-feedback";
import { readCalendarSubscriptionList } from "@/lib/calendar-subscription-list";
import { settingsMessages } from "@/i18n/settings";
jest.mock("@/components/fridge/sync-status", () => ({
  useNow: () => 1792497600000,
}));
function LocaleControl() {
  const { setLocale } = useTranslation();
  return <button onClick={() => setLocale("es")}>Switch presentation</button>;
}
async function mount() {
  const user = userEvent.setup();
  render(
    <I18nProvider locale="en">
      <LocaleControl />
      <CalendarSubscriptionsSection />
    </I18nProvider>,
  );
  await user.click(
    screen
      .getByRole("heading", { name: "Subscribed calendars" })
      .closest("summary")!,
  );
  return user;
}
it.each(["network", "http", "invalid-body", "missing-list"] as const)(
  "does not render a failed %s read as an empty household",
  async (failure) => {
    global.fetch = jest.fn(async () => {
      if (failure === "network") throw new Error("Fixture offline");
      return {
        ok: failure !== "http",
        json: async () => {
          if (failure === "invalid-body")
            throw new Error("Fixture invalid JSON");
          return failure === "missing-list" ? {} : { subscriptions: [] };
        },
      };
    }) as unknown as typeof fetch;
    await mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      settingsMessages.en.subscriptionsLoadFailed,
    );
    expect(
      screen.queryByText(settingsMessages.en.noSubscriptions),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: settingsMessages.en.retrySubscriptions,
      }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: settingsMessages.en.addCalendar }),
    ).toBeDisabled();
    expect(fetch).toHaveBeenCalledTimes(1);
  },
);
it("keeps drafts and failed/read-pending identity through mounted locale change; only explicit retry reads again", async () => {
  let finish!: (value: any) => void;
  const retry = new Promise((resolve) => {
    finish = resolve;
  });
  global.fetch = jest
    .fn()
    .mockRejectedValueOnce(new Error("Fixture offline"))
    .mockReturnValueOnce(retry);
  const user = await mount();
  await screen.findByRole("alert");
  const name = screen.getByLabelText(
    settingsMessages.en.calendarName,
  ) as HTMLInputElement;
  const url = screen.getByLabelText(
    settingsMessages.en.calendarLink,
  ) as HTMLInputElement;
  await user.type(name, "Private school 李");
  await user.type(url, "webcal://fixture.example/private.ics");
  const section = screen
    .getByRole("heading", { name: "Subscribed calendars" })
    .closest("details");
  await user.click(screen.getByText("Switch presentation"));
  expect(screen.getByRole("alert")).toHaveTextContent(
    settingsMessages.es.subscriptionsLoadFailed,
  );
  expect(screen.getByLabelText(settingsMessages.es.calendarName)).toBe(name);
  expect(name.value).toBe("Private school 李");
  expect(url.value).toBe("webcal://fixture.example/private.ics");
  expect(section).toHaveAttribute("open");
  expect(fetch).toHaveBeenCalledTimes(1);
  const button = screen.getByRole("button", {
    name: settingsMessages.es.retrySubscriptions,
  });
  act(() => {
    fireEvent.click(button);
    fireEvent.click(button);
  });
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  expect(
    screen.getByText(settingsMessages.es.loadingEllipsis),
  ).toBeInTheDocument();
  fireEvent.submit(name.closest("form")!);
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () =>
    finish({ ok: true, json: async () => ({ subscriptions: [] }) }),
  );
  await waitFor(() =>
    expect(
      screen.getByText(settingsMessages.es.noSubscriptions),
    ).toBeInTheDocument(),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(name.value).toBe("Private school 李");
  expect(url.value).toBe("webcal://fixture.example/private.ics");
  expect(
    screen.getByRole("button", { name: settingsMessages.es.addCalendar }),
  ).toBeEnabled();
  expect(
    (fetch as jest.Mock).mock.calls.every(
      ([path, init]) => path === "/api/calendar/subscriptions" && !init?.method,
    ),
  ).toBe(true);
});

// Authored UNRUN: an invalid list cannot become a usable empty household.
it("admits only bounded, unique subscription summaries and projects away extras", () => {
  const row = { id: "sub-1", name: "School", color: null, last_fetched_at: null, last_status: "pending", last_error: null };
  expect(readCalendarSubscriptionList({ subscriptions: [row, row] })).toBeNull();
  expect(readCalendarSubscriptionList({ subscriptions: Array.from({ length: 11 }, (_, index) => ({ ...row, id: String(index) })) })).toBeNull();
  expect(readCalendarSubscriptionList({ subscriptions: [{ ...row, last_fetched_at: "invalid-date" }] })).toBeNull();
  expect(readCalendarSubscriptionList({ subscriptions: [{ ...row, last_status: "future" }] })).toBeNull();
  expect(readCalendarSubscriptionList({ subscriptions: [{ ...row, name: null }] })).toBeNull();
  expect(readCalendarSubscriptionList({ subscriptions: [{ ...row, url_enc: "fixture-private-extra" }] })).toEqual([row]);
});
it("aborts the list read on unmount and ignores a late bridge response", async () => {
  let finish!: (value: unknown) => void; let signal: AbortSignal | undefined;
  global.fetch = jest.fn((_path, init) => {
    signal = init?.signal;
    return new Promise(resolve => { finish = resolve });
  }) as unknown as typeof fetch;
  const { unmount } = render(<I18nProvider locale="en"><CalendarSubscriptionsSection /></I18nProvider>);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => finish({ ok: true, json: async () => ({ subscriptions: [] }) }));
  expect(fetch).toHaveBeenCalledTimes(1);
});

// Authored UNRUN: reads cannot silently authorize another uncertain create.
it("serializes add and keeps an unknown save held after an explicit list read", async () => {
  global.fetch = jest.fn(async (_path, init) => {
    if (init?.method === "POST") throw new Error("Fixture interrupted save");
    return { ok: true, json: async () => ({ subscriptions: [] }) };
  }) as unknown as typeof fetch;
  const user = await mount();
  await screen.findByText(settingsMessages.en.noSubscriptions);
  const name = screen.getByLabelText(settingsMessages.en.calendarName);
  const url = screen.getByLabelText(settingsMessages.en.calendarLink);
  await user.type(name, "School fixture"); await user.type(url, "https://fixture.example/private.ics");
  act(() => { fireEvent.submit(name.closest("form")!); fireEvent.submit(name.closest("form")!); });
  await screen.findByText(settingsMessages.en.calendarWriteUnconfirmed);
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(name).toHaveValue("School fixture"); expect(url).toHaveValue("https://fixture.example/private.ics");
  expect(name).toBeDisabled();
  await user.click(screen.getByRole("button", { name: settingsMessages.en.checkSubscriptions }));
  await screen.findByText(settingsMessages.en.noSubscriptions);
  fireEvent.submit(name.closest("form")!);
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(screen.getByRole("button", { name: settingsMessages.en.addCalendar })).toBeDisabled();
});

it("holds an unknown refresh result and exposes list inspection instead of retrying", async () => {
  const row = {
    id: "refresh-fixture",
    name: "School fixture",
    color: null,
    last_fetched_at: null,
    last_status: "pending",
    last_error: null,
  };
  global.fetch = jest.fn(async (_path, init) => {
    if (init?.method === "POST")
      return {
        ok: true,
        json: async () => ({
          subscription: row,
          result: { status: "future_status", created: 0, updated: 0, deleted: 0 },
        }),
      };
    return { ok: true, json: async () => ({ subscriptions: [row] }) };
  }) as unknown as typeof fetch;
  const user = await mount();
  await user.click(screen.getByRole("button", { name: "Refresh School fixture" }));
  expect(await screen.findByText(settingsMessages.en.calendarWriteUnconfirmed)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: settingsMessages.en.checkSubscriptions })).toBeEnabled();
  expect((fetch as jest.Mock).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

// Authored UNRUN: persisted fixed-vocabulary errors relabel without replaying reads.
it("localizes a saved feed failure on mounted locale change without another fetch", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ subscriptions: [{
    id: "failure-fixture", name: "School fixture", color: null, last_fetched_at: null,
    last_status: "error", last_error: "Feed took too long to respond", url_hint: "Unavailable",
  }] }) })) as unknown as typeof fetch;
  const user = await mount();
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("status")
        .some((node) =>
          node.textContent?.includes(settingsMessages.en.calendarFeedTimeout),
        ),
    ).toBe(true),
  );
  await user.click(screen.getByText("Switch presentation"));
  expect(
    screen
      .getAllByRole("status")
      .some((node) =>
        node.textContent?.includes(settingsMessages.es.calendarFeedTimeout),
      ),
  ).toBe(true);
  expect(screen.getByText(settingsMessages.es.calendarHintUnavailable)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("keeps unknown/provider error text out of subscription feedback", () => {
  expect(calendarSubscriptionFeedback("fixture private provider details", "renameFailed")).toEqual({ key: "renameFailed" });
  expect(calendarSubscriptionFeedback({ message: "fixture private details" }, "addCalendarFailed")).toEqual({ key: "addCalendarFailed" });
  expect(calendarSubscriptionFeedback("constructor", "refreshFailed")).toEqual({ key: "refreshFailed" });
  expect(calendarSubscriptionFeedback("Feed could not be downloaded (HTTP 503)", "refreshFailed")).toEqual({ key: "calendarFeedHttp", params: { status: 503 } });
});
