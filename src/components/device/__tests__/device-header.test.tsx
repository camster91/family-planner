/** @jest-environment jsdom */
// Tablet header (owner decision 2026-11-19): only "+ Add to list" and
// "Parent"; the household helper moved into parent mode.
import "@testing-library/jest-dom";
import * as React from "react";
import { act, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { deviceManagementEnglish as copy } from "@/i18n/device-management";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import type { DeviceMe } from "../use-device-client";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));

const NOW = new Date(2026, 0, 5, 12, 0, 0);
const BOARD: TodayBoardData = {
  generatedAt: NOW.toISOString(),
  version: "v1",
  members: [{ id: "p", name: "Avery Parent", color: "purple" }],
  events: [],
  chores: [],
  dinners: [],
  shopping: { items: [], total: 0 },
  groceryLists: [{ id: "l1", name: "Groceries" }],
  links: { calendar: null, chores: null, meals: null, lists: null, features: null },
  weather: null,
  display: { idleMinutes: 0, night: null },
};
const ME: DeviceMe = {
  device: { id: "dev-1", label: "Kitchen" },
  household: { name: "Fixture household" },
  features: { calendar: true, chores: true, meals: true, lists: true },
  parents: [{ id: "p", name: "Avery Parent", hasPin: true }],
  deviceWrites: true,
  elevation: { active: false, memberId: null, expiresAt: null },
};

const client = {
  request: jest.fn(async (path: string) => (path === "/api/device/me" ? ME : {})),
  checkDeviceId: jest.fn(async () => true),
  isPurged: () => false,
  maybeRefresh: jest.fn(),
  getElevation: () => null,
  subscribe: () => () => undefined,
  endElevation: jest.fn(),
  notePageHide: jest.fn(),
  notePageShow: jest.fn(),
};

jest.mock("../use-device-client", () => {
  const actual = jest.requireActual("../use-device-client");
  return { ...actual, useDeviceClient: () => client };
});
jest.mock("../use-device-board-snapshot", () => {
  const ReactActual = jest.requireActual("react");
  return {
    useDeviceBoardSnapshot: ({ loadIdentity }: { loadIdentity: () => Promise<unknown> }) => {
      ReactActual.useEffect(() => {
        void loadIdentity();
      }, [loadIdentity]);
      return {
        data: BOARD,
        error: null,
        protocolError: false,
        cached: false,
        cacheUnavailable: false,
        load: async () => undefined,
        checkVersion: async () => "v1",
      };
    },
  };
});
jest.mock("@/lib/device-queue-browser", () => ({
  getDeviceQueue: () => ({
    ready: Promise.resolve(),
    list: () => [],
    subscribe: () => () => undefined,
    hasStorageReadError: () => false,
    requiresCompatibleClient: () => false,
    isDurable: () => true,
  }),
}));

// Imported after the mocks above so their factories see the fixtures.
import DeviceTodayScreen from "../DeviceTodayScreen";

it("shows only “+ Add to list” and “Parent” in the board header", async () => {
  jest.useFakeTimers({ now: NOW });
  try {
    render(
      <I18nProvider locale="en">
        <ToastProvider>
          <DeviceTodayScreen hasAccessCookie />
        </ToastProvider>
      </I18nProvider>,
    );
    await act(async () => {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    const header = screen.getByTestId("today-board").querySelector("header")!;
    const names = within(header)
      .getAllByRole("button")
      .map((button) => button.textContent?.trim());
    expect(names).toEqual([copy.addToList, copy.parentButton]);
    expect(screen.queryByRole("button", { name: copy.householdHelper })).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
