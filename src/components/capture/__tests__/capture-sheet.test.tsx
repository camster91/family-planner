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

it("keeps the launcher recoverable after a transient availability failure", async () => {
  let attempts = 0;
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/capture" && method === "GET") {
        attempts += 1;
        if (attempts === 1) throw new Error("offline");
        return response(200, {
          configured: true,
          allowed: true,
          userId: "user-a",
          familyId: "family-a",
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    },
  ) as unknown as typeof fetch;

  window.localStorage.setItem(
    "family-planner:capture-recovery:v1:user-a:family-a",
    JSON.stringify([
      {
        version: 1,
        key: "capture-retry-12345678",
        action: "event.create",
        requestHash: "a".repeat(64),
        body: JSON.stringify({ title: "Dentist", event_type: "other" }),
        title: "Dentist",
        kind: "event",
        createdAt: Date.now(),
        photo: false,
      },
    ]),
  );

  const user = userEvent.setup();
  mount();
  const launcher = await screen.findByRole("button", {
    name: "Open quick add",
  });
  await user.click(launcher);
  const dialog = screen.getByRole("dialog", { name: "Quick add" });
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Quick add could not connect",
  );
  await user.click(within(dialog).getByRole("button", { name: "Retry" }));
  expect(
    await within(dialog).findByRole("textbox", {
      name: "What would you like to add?",
    }),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("textbox", {
      name: "What would you like to add?",
    }),
  ).toHaveFocus();
  expect(
    within(dialog).getByRole("button", { name: "Retry Dentist" }),
  ).toBeVisible();
  expect(attempts).toBe(2);
});

it("does not focus the capture input when a closed sheet finishes retrying", async () => {
  let resolveRetry!: (value: Response) => void;
  let attempts = 0;
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    if (String(input) !== "/api/capture")
      throw new Error(`unexpected ${String(input)}`);
    attempts += 1;
    if (attempts === 1) throw new Error("offline");
    return new Promise<Response>((resolve) => {
      resolveRetry = resolve;
    });
  }) as unknown as typeof fetch;

  const user = userEvent.setup();
  mount();
  const launcher = await screen.findByRole("button", {
    name: "Open quick add",
  });
  await user.click(launcher);
  const dialog = screen.getByRole("dialog", { name: "Quick add" });
  await user.click(within(dialog).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(attempts).toBe(2));
  await user.click(
    within(dialog).getByRole("button", { name: "Close quick add" }),
  );
  expect(launcher).toHaveFocus();

  await act(async () => {
    resolveRetry(
      response(200, {
        configured: true,
        allowed: true,
        userId: "user-a",
        familyId: "family-a",
      }),
    );
  });
  expect(launcher).toHaveFocus();
});

it("hides the launcher for an explicit authenticated refusal", async () => {
  await expectUnavailable(() => Promise.resolve(response(401, {})));
});

it.each([401, 403])(
  "keeps an open sheet visible for a final auth refusal (%i)",
  async (status) => {
    let eventPosts = 0;
    global.fetch = jest.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url === "/api/capture" && method === "GET")
          return response(200, {
            configured: true,
            allowed: true,
            userId: "user-a",
            familyId: "family-a",
          });
        if (url === "/api/capture" && method === "POST")
          return response(200, {
            draft: {
              kind: "event",
              title: "Dentist",
              confidence: "high",
            },
          });
        if (url === "/api/events" && method === "POST") {
          eventPosts += 1;
          return response(status, { error: "unauthorized" });
        }
        throw new Error(`unexpected ${method} ${url}`);
      },
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Open quick add" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Quick add" });
    const input = within(dialog).getByRole("textbox", {
      name: "What would you like to add?",
    });
    await user.type(input, "dentist Tuesday");
    await user.click(within(dialog).getByRole("button", { name: "Read it" }));
    await user.click(
      await within(dialog).findByRole("button", { name: "Add it" }),
    );

    expect(screen.getByRole("dialog", { name: "Quick add" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Capture recovery is unavailable until access and storage are revalidated. Nothing was sent.",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry Dentist" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open quick add" }),
    ).not.toBeInTheDocument();
    expect(eventPosts).toBe(1);

    await user.click(
      within(screen.getByRole("dialog", { name: "Quick add" })).getByRole(
        "button",
        { name: "Close quick add" },
      ),
    );
    expect(
      screen.queryByRole("dialog", { name: "Quick add" }),
    ).not.toBeInTheDocument();
  },
);

it("opens the rounded sheet, restores focus after releasing inert, and keeps an unsent draft", async () => {
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
  const focusWhileInert: HTMLElement[] = [];
  const nativeFocus = HTMLElement.prototype.focus;
  const focusSpy = jest
    .spyOn(HTMLElement.prototype, "focus")
    .mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (
        this.closest<HTMLElement>("[data-dashboard-background]")?.inert === true
      ) {
        focusWhileInert.push(this);
      }
      nativeFocus.call(this, options);
    });
  try {
    await user.keyboard("{Escape}");
  } finally {
    focusSpy.mockRestore();
  }
  expect(
    screen.queryByRole("dialog", { name: "Quick add" }),
  ).not.toBeInTheDocument();
  expect(focusWhileInert).toHaveLength(0);
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

it("localizes the launcher, sheet chrome and capture controls", async () => {
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
      name: "¿Qué te gustaría añadir?",
    }),
  ).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Leerlo" })).toBeVisible();
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
