/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";
import PairTabletDialog from "../PairTabletDialog";
import { deviceManagementEnglish as copy } from "@/i18n/device-management";
import { PAIRING_POLL_MS } from "@/lib/device-client";
const onPaired = jest.fn();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function reply(body: unknown) {
  return { ok: true, json: async () => body, headers: new Headers() };
}
function pairing(id = "old-pair", code = "ABCD1234") {
  return {
    pairingId: id,
    code,
    expiresAt: new Date(Date.now() + 10000).toISOString(),
  };
}
function Harness() {
  const [open, setOpen] = React.useState(true);
  return (
    <I18nProvider locale="en">
      <button onClick={() => setOpen(true)}>Reopen fixture</button>
      <PairTabletDialog
        open={open}
        onClose={() => setOpen(false)}
        onPaired={onPaired}
      />
    </I18nProvider>
  );
}
async function submit(label = copy.getCode) {
  await act(async () => {
    fireEvent.submit(
      screen.getByRole("button", { name: label, exact: true }).closest("form")!,
    );
  });
}
async function tick(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-20T12:00:00Z"));
  onPaired.mockReset();
});
afterEach(() => {
  jest.useRealTimers();
});
it.each(["claimed", "paired"] as const)(
  "ignores a late %s poll body after local expiry",
  async (status) => {
    const body = deferred<unknown>();
    global.fetch = jest.fn(async (_path, init) =>
      init?.method === "POST"
        ? reply(pairing())
        : { ok: true, json: () => body.promise },
    ) as typeof fetch;
    const view = render(<Harness />);
    try {
      await submit();
      await tick(PAIRING_POLL_MS);
      await tick(10001);
      expect(screen.getByText(copy.endedExpired)).toBeInTheDocument();
      await act(async () => body.resolve({ status }));
      expect(screen.getByText(copy.endedExpired)).toBeInTheDocument();
      expect(screen.queryByTestId("pairing-code")).not.toBeInTheDocument();
      expect(onPaired).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      await tick(0);
    }
  },
);
it("does not let a previous poll replace a reopened dialog's code or keep polling while closed", async () => {
  const oldBody = deferred<unknown>();
  let creates = 0;
  global.fetch = jest.fn(async (_path, init) => {
    if (init?.method === "POST")
      return reply(
        ++creates === 1 ? pairing() : pairing("new-pair", "NEWC1234"),
      );
    if (init?.method === "DELETE") return reply({});
    return { ok: true, json: () => oldBody.promise };
  }) as typeof fetch;
  const view = render(<Harness />);
  try {
    await submit();
    await tick(PAIRING_POLL_MS);
    fireEvent.click(
      screen.getByRole("button", { name: copy.close, exact: true }),
    );
    const count = (fetch as jest.Mock).mock.calls.length;
    await tick(20000);
    expect(fetch).toHaveBeenCalledTimes(count);
    fireEvent.click(screen.getByText("Reopen fixture"));
    await submit();
    await act(async () => oldBody.resolve({ status: "paired" }));
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("NEWC1234");
    expect(onPaired).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await tick(0);
  }
});
it("retires only the abandoned code when creation JSON finishes after close and a new opening", async () => {
  const oldBody = deferred<unknown>();
  let creates = 0;
  global.fetch = jest.fn(async (_path, init) => {
    if (init?.method === "POST")
      return ++creates === 1
        ? { ok: true, json: () => oldBody.promise }
        : reply(pairing("new-pair", "NEWC1234"));
    return reply({});
  }) as typeof fetch;
  const view = render(<Harness />);
  try {
    await submit();
    fireEvent.submit(
      screen
        .getByRole("button", { name: copy.getCode, exact: true })
        .closest("form")!,
    );
    expect(
      (fetch as jest.Mock).mock.calls.filter(
        ([, init]) => init?.method === "POST",
      ),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: copy.close, exact: true }),
    );
    fireEvent.click(screen.getByText("Reopen fixture"));
    await submit();
    await act(async () => oldBody.resolve(pairing("abandoned-pair")));
    expect(fetch).toHaveBeenCalledWith(
      "/api/family/devices/pairings/abandoned-pair",
      { method: "DELETE" },
    );
    expect(
      (fetch as jest.Mock).mock.calls.some(
        ([path, init]) =>
          path === "/api/family/devices/pairings/new-pair" &&
          init?.method === "DELETE",
      ),
    ).toBe(false);
    expect(screen.getByTestId("pairing-code")).toHaveTextContent("NEWC1234");
    expect(onPaired).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await tick(0);
  }
});
it("single-flights confirmation and does not revive connecting after expiry", async () => {
  const confirm = deferred<any>();
  global.fetch = jest.fn(async (path, init) => {
    if (String(path).endsWith("/confirm")) return confirm.promise;
    if (init?.method === "POST") return reply(pairing());
    return reply({ status: "claimed" });
  }) as typeof fetch;
  const view = render(<Harness />);
  try {
    await submit();
    await tick(PAIRING_POLL_MS);
    fireEvent.change(screen.getByLabelText(copy.number), {
      target: { value: "1234" },
    });
    const form = screen
      .getByRole("button", { name: copy.connect })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(
      (fetch as jest.Mock).mock.calls.filter(([path]) =>
        String(path).endsWith("/confirm"),
      ),
    ).toHaveLength(1);
    await tick(10001);
    await act(async () => confirm.resolve(reply({})));
    expect(screen.getByText(copy.endedExpired)).toBeInTheDocument();
    expect(screen.queryByText(copy.connectingHelp)).not.toBeInTheDocument();
    expect(onPaired).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    await tick(0);
  }
});
