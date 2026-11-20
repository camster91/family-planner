/** @jest-environment jsdom */
// Tablet quick fixes (owner decision 2026-11-19): the tapping switch on
// Settings › Devices, first names only on the shared tablet (PIN title,
// parent picker, parent-mode banner) and the household helper in parent mode.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import TabletTappingSwitch from "../TabletTappingSwitch";
import ElevationSheet from "../ElevationSheet";
import ElevatedBanner from "../ElevatedBanner";
import {
  deviceManagementEnglish as copy,
  deviceManagementSpanish as es,
} from "@/i18n/device-management";
import type { DeviceClient, ElevationSession } from "@/lib/device-client";

function reply(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("Settings › Devices tapping switch", () => {
  it("shows the household switch and saves it through the board-settings route", async () => {
    global.fetch = jest.fn(async (_path: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? reply({ deviceWrites: { available: true, enabled: true } })
        : reply({ deviceWrites: { available: true, enabled: false } }),
    ) as unknown as typeof fetch;
    render(
      <I18nProvider locale="en">
        <TabletTappingSwitch />
      </I18nProvider>,
    );
    const toggle = await screen.findByRole("switch", { name: copy.tappingLabel });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(copy.tappingHelp)).toBeInTheDocument();
    fireEvent.click(toggle);
    await flush();
    expect(fetch).toHaveBeenLastCalledWith(
      "/api/family/board-settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ deviceWrites: { enabled: true } }),
      }),
    );
    expect(screen.getByRole("switch", { name: copy.tappingLabel })).toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent(copy.tappingOn);
  });

  it("says when the save failed and keeps the stored value", async () => {
    global.fetch = jest.fn(async (_path: string, init?: RequestInit) =>
      init?.method === "PATCH"
        ? reply({ error: "no" }, false)
        : reply({ deviceWrites: { available: true, enabled: true } }),
    ) as unknown as typeof fetch;
    render(
      <I18nProvider locale="es">
        <TabletTappingSwitch />
      </I18nProvider>,
    );
    const toggle = await screen.findByRole("switch", { name: es.tappingLabel });
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(es.tappingSaveFailed);
    expect(screen.getByRole("switch", { name: es.tappingLabel })).toBeChecked();
  });

  it("is hidden behind a plain note when the kill switch is off", async () => {
    global.fetch = jest.fn(async () =>
      reply({ deviceWrites: { available: false, enabled: false } }),
    ) as unknown as typeof fetch;
    render(
      <I18nProvider locale="en">
        <TabletTappingSwitch />
      </I18nProvider>,
    );
    expect(await screen.findByText(copy.tappingUnavailable)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("first names only on the shared tablet", () => {
  const parents = [
    { id: "p1", name: "Avery Fixture-A", hasPin: true },
    { id: "p2", name: "Jordan Fixture-B", hasPin: false },
  ];

  it("lists parents and titles the PIN step by first name", () => {
    render(
      <I18nProvider locale="en">
        <ElevationSheet
          open
          onClose={() => undefined}
          client={null}
          parents={parents}
          onElevated={() => undefined}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Avery" })).toBeInTheDocument();
    expect(screen.queryByText(/Fixture/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Avery" }));
    expect(
      screen.getByRole("heading", { name: "Avery, enter your tablet PIN" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Fixture-A");
  });

  it("names the parent by first name in the password fallback", () => {
    render(
      <I18nProvider locale="en">
        <ElevationSheet
          open
          onClose={() => undefined}
          client={null}
          parents={parents}
          onElevated={() => undefined}
        />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jordan" }));
    expect(
      screen.getByRole("heading", { name: "Jordan, enter your password" }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Fixture-B");
  });
});

describe("parent mode banner", () => {
  const session: ElevationSession = {
    token: "fixture-token",
    member: { id: "p1", name: "Avery Fixture-A" },
    expiresAt: Date.now() + 15 * 60_000,
    idleTimeoutMs: 5 * 60_000,
    lastUsedAt: Date.now(),
  };
  const client = {
    getElevation: () => session,
  } as unknown as DeviceClient;

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("names the parent by first name and holds the household helper", () => {
    render(
      <I18nProvider locale="en">
        <ElevatedBanner
          client={client}
          session={session}
          onExpire={() => undefined}
          onDone={() => undefined}
          onRename={() => undefined}
          onRemove={() => undefined}
          helper={<button type="button">{copy.householdHelper}</button>}
        />
      </I18nProvider>,
    );
    const banner = screen.getByTestId("elevated-banner");
    expect(banner).toHaveTextContent("Parent mode: Avery");
    expect(banner).not.toHaveTextContent("Fixture-A");
    expect(
      screen.getByRole("button", { name: copy.householdHelper }),
    ).toBeInTheDocument();
  });
});
