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
import { I18nProvider } from "@/i18n";

let mockProviderReturnInvocations = 0;

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn(), push: jest.fn() }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: any) => (
    <a href={String(href)} {...rest}>
      {children}
    </a>
  ),
}));

// Model the lazy child resolving after a person has already chosen a tab.
// The real CalendarSyncSection invokes this callback once after provider
// return; the delay makes the navigation race deterministic.
jest.mock("../CalendarSyncSection", () => {
  const React = require("react") as typeof import("react");
  function DelayedCalendarSyncSection({
    onProviderReturn,
  }: {
    onProviderReturn?: () => void;
  }) {
    React.useEffect(() => {
      const timer = window.setTimeout(() => {
        mockProviderReturnInvocations += 1;
        onProviderReturn?.();
      }, 50);
      return () => window.clearTimeout(timer);
    }, [onProviderReturn]);
    return (
      <section aria-label="Connected calendars">
        <h3>Connected calendars</h3>
      </section>
    );
  }
  return { __esModule: true, default: DelayedCalendarSyncSection };
});

import SettingsClient from "../SettingsClient";

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockProviderReturnInvocations = 0;
  HTMLElement.prototype.scrollIntoView = jest.fn();
  window.history.replaceState(
    null,
    "",
    "/dashboard/settings?calendar_sync=scope",
  );
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/users")
      return reply(200, {
        user: {
          name: "Synthetic parent",
          email: "parent@example.test",
          role: "parent",
          age: null,
        },
      });
    return reply(200, { providers: [], connections: [] });
  }) as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  window.history.replaceState(null, "", "/");
});

it.each([
  ["en", "Your account", "Family"],
  ["es", "Tu cuenta", "Familia"],
] as const)(
  "does not let a delayed provider return reopen Family after explicit navigation (%s)",
  async (locale, accountLabel, familyLabel) => {
    render(
      <I18nProvider locale={locale}>
        <SettingsClient viewerRole="parent" sharedDevice={null} calendarSync />
      </I18nProvider>,
    );

    await screen.findByLabelText(
      locale === "en" ? "Full Name" : "Nombre completo",
    );
    const family = screen.getByRole("button", { name: familyLabel });
    const account = screen.getByRole("button", { name: accountLabel });

    fireEvent.click(family);
    fireEvent.click(account);
    expect(account).toHaveAttribute("aria-pressed", "true");

    await act(async () => {
      jest.advanceTimersByTime(50);
    });

    expect(mockProviderReturnInvocations).toBe(1);
    await waitFor(() =>
      expect(account).toHaveAttribute("aria-pressed", "true"),
    );
    expect(family).toHaveAttribute("aria-pressed", "false");
  },
);
