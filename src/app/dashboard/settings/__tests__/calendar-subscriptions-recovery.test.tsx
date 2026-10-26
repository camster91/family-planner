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
