/** @jest-environment jsdom */
// Owner decision 2026-11-19: confirming a pairing on the parent's phone asks
// "Let everyone tick chores and add groceries on this tablet?" with Yes
// (recommended) preselected. Yes turns on the household's existing tablet
// writes switch through PATCH /api/family/board-settings; View only changes
// nothing and the "connected" step says what is true.
import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import PairTabletDialog from "../PairTabletDialog";
import {
  deviceManagementEnglish as copy,
  deviceManagementSpanish as es,
} from "@/i18n/device-management";
import { PAIRING_POLL_MS } from "@/lib/device-client";

function reply(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, headers: new Headers() };
}

type Settings = { ok: boolean; enabled: boolean };

function router({
  patch = { ok: true, enabled: true },
  get = { ok: true, enabled: false },
}: { patch?: Settings; get?: Settings } = {}) {
  let confirmed = false;
  return jest.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (path === "/api/family/devices/pairings" && method === "POST")
      return reply({
        pairingId: "pair-1",
        code: "ABCD1234",
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
    if (path === "/api/family/devices/pairings/pair-1/confirm") {
      confirmed = true;
      return reply({ status: "confirmed" });
    }
    if (path === "/api/family/devices/pairings/pair-1")
      return reply({ status: confirmed ? "paired" : "claimed" });
    if (path === "/api/family/board-settings") {
      const answer = method === "PATCH" ? patch : get;
      return answer.ok
        ? reply({ deviceWrites: { available: true, enabled: answer.enabled } })
        : reply({ error: "nope" }, false, 500);
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function reachConfirm(locale: "en" | "es" = "en") {
  const view = render(
    <I18nProvider locale={locale}>
      <PairTabletDialog open onClose={() => undefined} onPaired={() => undefined} />
    </I18nProvider>,
  );
  const text = locale === "en" ? copy : es;
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: text.getCode }).closest("form")!);
  });
  await tick(PAIRING_POLL_MS);
  await tick(0);
  return view;
}

async function confirmAndConnect(text: Record<keyof typeof copy, string> = copy) {
  fireEvent.change(screen.getByLabelText(text.number), { target: { value: "1234" } });
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: text.connect }).closest("form")!);
  });
  await tick(0);
  await tick(PAIRING_POLL_MS);
  await tick(0);
}

const boardSettingsCalls = () =>
  (fetch as jest.Mock).mock.calls.filter(([path]) => path === "/api/family/board-settings");

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-19T12:00:00Z"));
});
afterEach(() => {
  jest.useRealTimers();
});

it("asks the tapping question with Yes (recommended) preselected", async () => {
  global.fetch = router() as unknown as typeof fetch;
  const view = await reachConfirm();
  try {
    const group = screen.getByRole("group", { name: copy.writesQuestion });
    const yes = within(group).getByRole("radio", { name: new RegExp(copy.writesYes.replace(/[()]/g, "\\$&")) });
    const viewOnly = within(group).getByRole("radio", { name: new RegExp(copy.writesViewOnly) });
    expect(yes).toBeChecked();
    expect(viewOnly).not.toBeChecked();
    // Nothing is saved before the parent confirms the pairing.
    expect(boardSettingsCalls()).toHaveLength(0);
  } finally {
    view.unmount();
  }
});

it("Yes turns on the household's tablet writes after the pairing is confirmed", async () => {
  global.fetch = router() as unknown as typeof fetch;
  const view = await reachConfirm();
  try {
    await confirmAndConnect();
    expect(boardSettingsCalls()).toEqual([
      [
        "/api/family/board-settings",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ deviceWrites: { enabled: true } }),
        }),
      ],
    ]);
    expect(screen.getByRole("heading", { name: copy.connected })).toBeInTheDocument();
    expect(screen.getByTestId("pair-writes-outcome")).toHaveTextContent(copy.writesOnDone);
  } finally {
    view.unmount();
  }
});

it("View only changes nothing and says the tablet is view only", async () => {
  global.fetch = router({ get: { ok: true, enabled: false } }) as unknown as typeof fetch;
  const view = await reachConfirm();
  try {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(copy.writesViewOnly) }));
    await confirmAndConnect();
    const calls = boardSettingsCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ method: "GET" });
    expect(screen.getByTestId("pair-writes-outcome")).toHaveTextContent(copy.writesViewOnlyDone);
  } finally {
    view.unmount();
  }
});

it("View only is honest when tapping is already on for the household", async () => {
  global.fetch = router({ get: { ok: true, enabled: true } }) as unknown as typeof fetch;
  const view = await reachConfirm();
  try {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(copy.writesViewOnly) }));
    await confirmAndConnect();
    expect(boardSettingsCalls().every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
    expect(screen.getByTestId("pair-writes-outcome")).toHaveTextContent(copy.writesAlreadyOnDone);
  } finally {
    view.unmount();
  }
});

it("a failed Yes keeps the pairing and tells the parent where to turn tapping on", async () => {
  global.fetch = router({ patch: { ok: false, enabled: false } }) as unknown as typeof fetch;
  const view = await reachConfirm();
  try {
    await confirmAndConnect();
    expect(screen.getByRole("heading", { name: copy.connected })).toBeInTheDocument();
    const outcome = screen.getByTestId("pair-writes-outcome");
    expect(outcome).toHaveAttribute("role", "alert");
    expect(outcome).toHaveTextContent(copy.writesFailed);
  } finally {
    view.unmount();
  }
});

it("asks in Spanish too", async () => {
  global.fetch = router() as unknown as typeof fetch;
  const view = await reachConfirm("es");
  try {
    expect(screen.getByRole("group", { name: es.writesQuestion })).toBeInTheDocument();
    await confirmAndConnect(es);
    expect(screen.getByTestId("pair-writes-outcome")).toHaveTextContent(es.writesOnDone);
  } finally {
    view.unmount();
  }
});
