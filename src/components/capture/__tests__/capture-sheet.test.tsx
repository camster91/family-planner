/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { webcrypto } from "node:crypto";
import { TextDecoder, TextEncoder } from "node:util";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { CaptureSheet } from "../CaptureSheet";

if (!globalThis.crypto?.subtle)
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
if (!globalThis.TextEncoder)
  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: TextEncoder,
  });
if (!globalThis.TextDecoder)
  Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: TextDecoder,
  });

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function mount(locale: "en" | "es" = "en", onSaved = jest.fn()) {
  return render(
    <I18nProvider locale={locale}>
      <div data-dashboard-background>
        <CaptureSheet onSaved={onSaved} />
      </div>
    </I18nProvider>,
  );
}

function configuredFetch() {
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/capture" && method === "GET") {
        return response(200, {
          configured: true,
          allowed: true,
          userId: "user-a",
          familyId: "family-a",
        });
      }
      if (url === "/api/capture" && method === "POST") {
        return response(200, {
          draft: {
            kind: "event",
            title: "Dentist",
            start_time: "2026-10-06T19:00:00.000Z",
            confidence: "high",
          },
        });
      }
      if (url === "/api/events" && method === "POST")
        return response(201, { event: { id: "event-a" } });
      throw new Error(`unexpected ${method} ${url}`);
    },
  ) as unknown as typeof fetch;
}

beforeEach(() => {
  window.localStorage.clear();
});

it("fails closed while availability is still loading", async () => {
  let resolveGate!: (value: Response) => void;
  global.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        resolveGate = resolve;
      }),
  ) as unknown as typeof fetch;

  mount();
  expect(
    screen.queryByRole("button", { name: "Open quick add" }),
  ).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");

  await act(async () =>
    resolveGate(
      response(200, {
        configured: true,
        allowed: true,
        userId: "user-a",
        familyId: "family-a",
      }),
    ),
  );
  expect(
    await screen.findByRole("button", { name: "Open quick add" }),
  ).toBeVisible();
});

async function expectUnavailable(fetcher: () => Promise<Response>) {
  global.fetch = jest.fn(fetcher) as unknown as typeof fetch;
  mount();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Open quick add" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.body.style.overflow).toBe("");
}

it("hides the launcher when capture is configured off", async () => {
  await expectUnavailable(() =>
    Promise.resolve(response(200, { configured: false, allowed: true })),
  );
});

it("hides the launcher when the current role is not allowed", async () => {
  await expectUnavailable(() =>
    Promise.resolve(response(200, { configured: true, allowed: false })),
  );
});

it("hides the launcher after a capability response or network failure", async () => {
  await expectUnavailable(() => Promise.resolve(response(503, {})));
  await expectUnavailable(() => Promise.reject(new Error("offline")));
});

it("opens the rounded sheet, restores the launcher focus, and keeps an unsent draft", async () => {
  configuredFetch();
  const user = userEvent.setup();
  mount();
  const launcher = await screen.findByRole("button", {
    name: "Open quick add",
  });

  await user.click(launcher);
  const dialog = screen.getByRole("dialog", { name: "Quick add" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(
    document.querySelector<HTMLElement>("[data-dashboard-background]")?.inert,
  ).toBe(true);
  const input = within(dialog).getByRole("textbox", {
    name: "What would you like to add?",
  });
  expect(input).toHaveFocus();
  await user.type(input, "dentist Tuesday");
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("dialog", { name: "Quick add" }),
  ).not.toBeInTheDocument();
  expect(launcher).toHaveFocus();
  expect(
    document.querySelector<HTMLElement>("[data-dashboard-background]")?.inert,
  ).toBe(false);

  await user.click(launcher);
  expect(
    within(screen.getByRole("dialog", { name: "Quick add" })).getByRole(
      "textbox",
    ),
  ).toHaveValue("dentist Tuesday");
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(global.fetch).not.toHaveBeenCalledWith(
    "/api/events",
    expect.anything(),
  );
});

it("localizes the launcher and sheet chrome without changing the capture controls", async () => {
  configuredFetch();
  const user = userEvent.setup();
  mount("es");
  const launcher = await screen.findByRole("button", {
    name: "Abrir adición rápida",
  });
  await user.click(launcher);
  const dialog = screen.getByRole("dialog", { name: "Adición rápida" });
  expect(dialog).toHaveTextContent(
    "Añade un evento, una tarea o un artículo de supermercado",
  );
  expect(
    within(dialog).getByRole("button", { name: "Cerrar adición rápida" }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("textbox", {
      name: "What would you like to add?",
    }),
  ).toBeVisible();
});

it("blocks Escape and close while a confirmed write is pending", async () => {
  let resolveEvent!: (value: Response) => void;
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === "/api/capture" && method === "GET") {
      return Promise.resolve(
        response(200, {
          configured: true,
          allowed: true,
          userId: "user-a",
          familyId: "family-a",
        }),
      );
    }
    if (url === "/api/capture" && method === "POST") {
      return Promise.resolve(
        response(200, {
          draft: {
            kind: "event",
            title: "Dentist",
            start_time: "2026-10-06T19:00:00.000Z",
            confidence: "high",
          },
        }),
      );
    }
    if (url === "/api/events" && method === "POST") {
      return new Promise<Response>((resolve) => {
        resolveEvent = resolve;
      });
    }
    return Promise.reject(new Error(`unexpected ${method} ${url}`));
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole("button", { name: "Open quick add" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Quick add" });
  await user.type(within(dialog).getByRole("textbox"), "dentist Tuesday");
  await user.click(within(dialog).getByRole("button", { name: "Read it" }));
  await user.click(
    await within(dialog).findByRole("button", { name: "Add it" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", { name: "Close quick add" }),
    ).not.toBeInTheDocument(),
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "Quick add" })).toBeVisible();

  await act(async () =>
    resolveEvent(response(201, { event: { id: "event-a" } })),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole("dialog", { name: "Quick add" })).getByRole(
        "button",
        { name: "Close quick add" },
      ),
    ).toBeVisible(),
  );
});
