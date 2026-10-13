/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider, useTranslation } from "@/i18n";
import AssistantHost from "../AssistantHost";
let mockMode = "",
  mockRecognition: any;
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/today",
  useSearchParams: () => new URLSearchParams(mockMode),
  useRouter: () => ({ push: jest.fn(), refresh: mockRefresh }),
}));
jest.mock("@/components/providers/features-provider", () => ({
  useFeatures: () => ({
    features: require("@/lib/features").defaultFeatures(),
  }),
}));
const response = (
  data: unknown,
  ok = true,
  headers: Record<string, string> = {},
  status = ok ? 200 : 503,
) => ({
  ok,
  status,
  headers: new Headers(headers),
  json: async () => data,
});
beforeEach(() => {
  mockMode = "";
  mockRefresh.mockClear();
  Object.defineProperty(global.crypto, "randomUUID", {
    value: () => "24db1d70-1278-4e01-b4aa-a0efc1f7387d",
    configurable: true,
  });
  delete (window as any).SpeechRecognition;
});
it("proposes an editable list and only writes after explicit confirm", async () => {
  const user = userEvent.setup(),
    calls: any[] = [];
  global.fetch = jest.fn(async (path, options) => {
    calls.push({ path, options });
    return response(
      path === "/api/assistant"
        ? {
            reply: "Review this list.",
            action: { kind: "list_create", title: "Trip", type: "custom" },
          }
        : { list: { id: "l" } },
    );
  }) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Make a trip list");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const title = await screen.findByLabelText("Proposed title");
  expect(calls).toHaveLength(1);
  await user.clear(title);
  await user.type(title, "Weekend trip");
  await user.click(screen.getByRole("button", { name: "Confirm and save" }));
  await screen.findByText("Saved “Weekend trip”.");
  expect(calls[1].path).toBe("/api/lists/create");
  expect(JSON.parse(calls[1].options.body).name).toBe("Weekend trip");
});
it("requires choosing an actual record and deletion checkbox", async () => {
  const user = userEvent.setup(),
    calls: string[] = [];
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    return response(
      path === "/api/assistant"
        ? {
            reply: "Choose the exact list.",
            action: { kind: "list_delete", title: "Trip" },
          }
        : {
            lists: [
              { id: "l", name: "Trip", type: "custom", description: "Camping" },
              {
                id: "other",
                name: "Trip",
                type: "custom",
                description: "Beach",
              },
            ],
          },
    );
  }) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Remove Trip");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Item to remove");
  expect(
    screen.getByRole("option", { name: "Trip · custom · Camping" }),
  ).toHaveValue("l");
  expect(
    screen.getByRole("option", { name: "Trip · custom · Beach" }),
  ).toHaveValue("other");
  expect(
    screen.getByRole("button", { name: "Remove selected item" }),
  ).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Item to remove"), "l");
  expect(
    screen.getByRole("button", { name: "Remove selected item" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "Remove selected item" }),
  ).toBeEnabled();
  expect(calls).toEqual(["/api/assistant", "/api/lists"]);
});

it("keeps a chore proposal and draft when member choices fail, then reloads choices only", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  let memberLoads = 0;
  let releaseMembers: (() => void) | undefined;
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    if (path === "/api/assistant")
      return response({
        reply: "Choose who does it.",
        action: {
          kind: "chore_create",
          title: "Recycling",
          frequency: "weekly",
          weekdays: [1, 4],
          points: 10,
          difficulty: "easy",
        },
      });
    if (path === "/api/family/members") {
      memberLoads += 1;
      if (memberLoads === 1) return response({ error: "Provider unavailable" }, false);
      if (memberLoads === 2)
        return new Promise((resolve) => {
          releaseMembers = () =>
            resolve(
              response({
                members: [{ id: "member-a", name: "Avery" }],
              }),
            );
        });
      return response({ members: [{ id: "member-a", name: "Avery" }] });
    }
    return response({ chore: { id: "chore-a" } });
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  const draft = "Add recycling Mondays and Thursdays";
  await user.type(within(dialog).getByLabelText("Your message"), draft);
  await user.click(within(dialog).getByRole("button", { name: "Send" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Could not load choices.",
  );
  expect(within(dialog).getByLabelText("Proposed title")).toHaveValue(
    "Recycling",
  );
  expect(within(dialog).getByLabelText("Your message")).toHaveValue(draft);
  const reload = within(dialog).getByRole("button", { name: "Reload choices" });
  const retrying = user.click(reload);
  await waitFor(() => expect(releaseMembers).toEqual(expect.any(Function)));
  await user.click(reload);
  releaseMembers!();
  await retrying;
  await within(dialog).findByRole("option", { name: "Avery" });
  expect(calls).toEqual([
    "/api/assistant",
    "/api/family/members",
    "/api/family/members",
  ]);

  await user.selectOptions(within(dialog).getByLabelText("Chore assignee"), "member-a");
  await user.click(within(dialog).getByRole("button", { name: "Confirm and save" }));
  await within(dialog).findByText("Saved “Recycling”.");
  expect(calls).toEqual([
    "/api/assistant",
    "/api/family/members",
    "/api/family/members",
    "/api/chores/create",
  ]);
});

it("keeps a removal proposal when its choices GET fails, then reloads that GET only", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  let eventLoads = 0;
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    if (path === "/api/assistant")
      return response({
        reply: "Choose the exact event.",
        action: { kind: "event_delete", title: "Dentist" },
      });
    if (path === "/api/events") {
      eventLoads += 1;
      if (eventLoads === 1) throw new TypeError("Offline");
      return response({
        events: [
          {
            id: "event-a",
            title: "Dentist",
            start_time: "2026-10-12T15:00:00Z",
          },
        ],
      });
    }
    return response({ success: true });
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Your message"), "Remove dentist");
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Could not load choices.",
  );
  expect(within(dialog).getByLabelText("Item to remove")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Reload choices" }));
  await within(dialog).findByRole("option", { name: /Dentist/ });
  expect(calls).toEqual(["/api/assistant", "/api/events", "/api/events"]);

  await user.selectOptions(within(dialog).getByLabelText("Item to remove"), "event-a");
  await user.click(within(dialog).getByRole("checkbox"));
  await user.click(
    within(dialog).getByRole("button", { name: "Remove selected item" }),
  );
  await within(dialog).findByText("Removed “Dentist”.");
  expect(calls).toEqual([
    "/api/assistant",
    "/api/events",
    "/api/events",
    "/api/events",
  ]);
});
it("child gets reports but no paid assistant; shared fridge shows neither launcher", () => {
  const view = render(<AssistantHost role="child" />);
  expect(screen.queryByRole("button", { name: "AI assistant" })).toBeNull();
  expect(screen.getByRole("button", { name: "Report / Suggest" })).toBeTruthy();
  view.unmount();
  mockMode = "mode=fridge";
  render(<AssistantHost role="parent" />);
  expect(screen.queryByRole("button", { name: "Report / Suggest" })).toBeNull();
});
it("tucks launchers away for external form focus and restores dialog focus", async () => {
  const user = userEvent.setup();
  render(
    <>
      <label htmlFor="settings-field">Settings field</label>
      <input id="settings-field" />
      <button type="button">Other control</button>
      <AssistantHost role="parent" />
    </>,
  );
  const launchers = document.querySelector<HTMLElement>(
    "[data-person-assistant]",
  )!;
  const settingsField = screen.getByLabelText("Settings field");
  const other = screen.getByRole("button", { name: "Other control" });
  const assistantLauncher = screen.getByRole("button", {
    name: "AI assistant",
  });

  await user.click(settingsField);
  expect(launchers).toHaveAttribute("data-launchers-suppressed", "true");
  expect(launchers).toHaveClass(
    "invisible",
    "pointer-events-none",
    "opacity-0",
  );
  expect(assistantLauncher).toHaveAttribute("tabindex", "-1");

  await user.click(other);
  expect(launchers).not.toHaveAttribute("data-launchers-suppressed");
  expect(launchers).not.toHaveClass("invisible");
  expect(assistantLauncher).not.toHaveAttribute("tabindex");

  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "AI assistant" })).toHaveFocus(),
  );
});
it("keeps both launcher actions reachable in a compact 320px layout", () => {
  render(<AssistantHost role="parent" />);
  const launchers = document.querySelector<HTMLElement>(
    "[data-person-assistant]",
  )!;
  expect(launchers).toHaveClass(
    "relative",
    "w-full",
    "max-[320px]:w-full",
    "max-[320px]:flex-nowrap",
    "max-[320px]:justify-end",
    "pb-[calc(max(5rem,var(--phone-tab-bar-height,0px))+env(safe-area-inset-bottom,0px)+1rem)]",
    "md:pb-6",
  );
  const buttons = within(launchers).getAllByRole("button");
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button).toHaveClass(
      "min-h-[44px]",
      "max-[320px]:h-11",
      "max-[320px]:w-11",
      "max-[320px]:shrink-0",
    );
  }
  expect(screen.getByText("Report / Suggest")).toHaveClass(
    "max-[320px]:sr-only",
  );
  expect(screen.getByText("AI assistant")).toHaveClass("max-[320px]:sr-only");
});
it("keeps a chat draft when the assistant is closed and reopened", async () => {
  const user = userEvent.setup();
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const message = screen.getByLabelText("Your message");
  await user.type(message, "Add library pickup tomorrow");
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  expect(screen.getByLabelText("Your message")).toHaveValue(
    "Add library pickup tomorrow",
  );
});
it("keeps exact report labels and unsent values after reopening", async () => {
  const user = userEvent.setup();
  render(<AssistantHost role="parent" />);
  const launcher = screen.getByRole("button", { name: "Report / Suggest" });
  await user.click(launcher);
  await user.type(
    screen.getByLabelText("Title", { exact: true }),
    "Fixture report draft",
  );
  await user.type(
    screen.getByLabelText("What happened or what would help?", { exact: true }),
    "Fixture details remain private and unsent.",
  );
  await user.click(screen.getByRole("button", { name: "Close" }));
  await user.click(launcher);
  expect(screen.getByLabelText("Title", { exact: true })).toHaveValue(
    "Fixture report draft",
  );
  expect(
    screen.getByLabelText("What happened or what would help?", { exact: true }),
  ).toHaveValue("Fixture details remain private and unsent.");
});
it("saves private feedback and displays a real receipt", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(async () =>
    response({ report: { id: "saved-receipt" } }),
  ) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "Report / Suggest" }));
  await user.type(screen.getByLabelText("Title"), "More calendar controls");
  await user.type(
    screen.getByLabelText("What happened or what would help?"),
    "Please let me change calendar density.",
  );
  await user.click(screen.getByRole("button", { name: "Save report" }));
  expect(await screen.findByRole("status")).toHaveTextContent("saved-receipt");
});
it("voice fills draft, never sends automatically, and stops when closing", async () => {
  class Recognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: any;
    onerror: any;
    onend: any;
    start = jest.fn();
    abort = jest.fn();
    constructor() {
      mockRecognition = this;
    }
  }
  (window as any).SpeechRecognition = Recognition;
  const user = userEvent.setup();
  global.fetch = jest.fn() as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.click(screen.getByRole("button", { name: "Voice input" }));
  const { act } = require("@testing-library/react");
  act(() =>
    mockRecognition.onresult({ results: [[{ transcript: "Add milk" }]] }),
  );
  expect(screen.getByLabelText("Your message")).toHaveValue("Add milk");
  expect(global.fetch).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(mockRecognition.abort).toHaveBeenCalled();
});
it("unconfigured AI is shown honestly and keyboard closes the sheet", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(async () =>
    response({ error: "AI is not connected yet." }, false),
  ) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Add milk");
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not connected");
  expect(
    screen.getByRole("link", { name: "Household AI setup in Settings" }),
  ).toHaveAttribute("href", "/dashboard/settings?setup=ai#ai-capture");
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("keeps a failed chat request exact while retrying without overwriting a newer draft", async () => {
  const user = userEvent.setup();
  const calls: { path: string; body?: any }[] = [];
  let attempt = 0;
  global.fetch = jest.fn(async (path, options) => {
    const body = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ path: String(path), body });
    if (attempt++ === 0) throw new TypeError("Failed to fetch");
    return response({ reply: "Recovered answer.", action: null });
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const message = screen.getByLabelText("Your message");
  await user.type(message, "Add school pickup tomorrow");
  await user.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "No connection",
  );
  expect(message).toHaveValue("Add school pickup tomorrow");
  await user.clear(message);
  await user.type(message, "A newer draft");
  await user.click(screen.getByRole("button", { name: "Retry message" }));

  await screen.findByText("Recovered answer.");
  expect(message).toHaveValue("A newer draft");
  expect(calls).toHaveLength(2);
  expect(calls[0].path).toBe("/api/assistant");
  expect(calls[1].path).toBe("/api/assistant");
  expect(calls[1].body).toEqual(calls[0].body);

  await user.click(screen.getByRole("button", { name: "Send" }));
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(calls[2].path).toBe("/api/assistant");
  expect(calls[2].body.messages.at(-1)).toEqual({
    role: "user",
    content: "A newer draft",
  });
});

it("localizes provider setup and unreadable chat recovery without granting teen setup access", async () => {
  const user = userEvent.setup();
  let mode: "setup" | "unreadable" = "setup";
  global.fetch = jest.fn(async () =>
    mode === "setup"
      ? response(
          {
            error:
              "AI is not connected yet. Ask a parent to connect the household AI provider.",
          },
          false,
        )
      : response({ reply: "missing action" }),
  ) as any;

  render(
    <I18nProvider locale="es">
      <AssistantHost role="teen" />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Asistente de IA" }));
  const dialog = screen.getByRole("dialog");
  const message = within(dialog).getByLabelText("Tu mensaje");
  await user.type(message, "Ayuda");
  await user.click(within(dialog).getByRole("button", { name: "Enviar" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "La IA del hogar aún no está conectada",
  );
  expect(
    within(dialog).queryByRole("link", { name: "Configurar la IA del hogar en Ajustes" }),
  ).toBeNull();
  expect(message).toHaveValue("Ayuda");

  mode = "unreadable";
  await user.click(within(dialog).getByRole("button", { name: "Reintentar mensaje" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "No se pudo leer la respuesta de IA",
  );
  expect(
    within(dialog).getByRole("button", { name: "Reintentar mensaje" }),
  ).toBeEnabled();
});

it("locks chat send and retry controls while a recovery request is pending", async () => {
  const user = userEvent.setup();
  let attempt = 0;
  let release!: (value: unknown) => void;
  global.fetch = jest.fn(async () => {
    if (attempt++ === 0) throw new TypeError("Failed to fetch");
    return new Promise((resolve) => {
      release = resolve;
    });
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const message = screen.getByLabelText("Your message");
  await user.type(message, "Check the calendar");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByRole("button", { name: "Retry message" });
  await user.click(screen.getByRole("button", { name: "Retry message" }));

  expect(screen.getByRole("button", { name: "Retry message" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
  release(response({ reply: "Done.", action: null }));
  await screen.findByText("Done.");
});

it("offers a read-only affected-section check after an uncertain action without a mutation retry", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    if (path === "/api/assistant")
      return response({
        reply: "Review this list.",
        action: { kind: "list_create", title: "Trip", type: "custom" },
      });
    throw new TypeError("Connection lost after the write");
  }) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Make a trip list");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(await screen.findByRole("button", { name: "Confirm and save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "connection ended before confirmation",
  );
  const checkLink = screen.getByRole("link", { name: "Check Lists" });
  expect(checkLink).toHaveAttribute("href", "/dashboard/lists");
  expect(screen.queryByRole("button", { name: "Retry message" })).toBeNull();
  expect(calls).toEqual(["/api/assistant", "/api/lists/create"]);
});

it("keeps a grocery proposal editable after list discovery fails until explicit confirm", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  let listLoads = 0;
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    if (path === "/api/assistant")
      return response({
        reply: "Review this grocery item.",
        action: { kind: "grocery_add", title: "Milk" },
      });
    if (path === "/api/lists") {
      listLoads += 1;
      return listLoads === 1
        ? response({ error: "Lists unavailable" }, false)
        : response({ lists: [{ id: "grocery-a", type: "grocery" }] });
    }
    return response({ item: { id: "item-a" } });
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Add milk");
  await user.click(screen.getByRole("button", { name: "Send" }));
  const confirm = await screen.findByRole("button", {
    name: "Confirm and save",
  });
  await user.click(confirm);

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Could not load choices.",
  );
  expect(
    screen.getByRole("region", { name: "Review proposed action" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Confirm and save" })).toBeEnabled();
  expect(calls).toEqual(["/api/assistant", "/api/lists"]);

  await user.click(screen.getByRole("button", { name: "Confirm and save" }));
  await screen.findByText("Saved “Milk”.");
  expect(calls).toEqual([
    "/api/assistant",
    "/api/lists",
    "/api/lists",
    "/api/lists/items/create",
  ]);
});

it("keeps a grocery item write uncertain after discovery succeeds", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    if (path === "/api/assistant")
      return response({
        reply: "Review this grocery item.",
        action: { kind: "grocery_add", title: "Milk" },
      });
    if (path === "/api/lists")
      return response({ lists: [{ id: "grocery-a", type: "grocery" }] });
    throw new TypeError("Connection lost after the write");
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Add milk");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await user.click(
    await screen.findByRole("button", { name: "Confirm and save" }),
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "connection ended before confirmation",
  );
  expect(screen.getByRole("link", { name: "Check Lists" })).toHaveAttribute(
    "href",
    "/dashboard/lists",
  );
  expect(
    screen.queryByRole("button", { name: "Confirm and save" }),
  ).toBeNull();
  expect(calls).toEqual([
    "/api/assistant",
    "/api/lists",
    "/api/lists/items/create",
  ]);
});

it("requires choosing a real household member before creating a weekly chore", async () => {
  const user = userEvent.setup(),
    calls: any[] = [];
  global.fetch = jest.fn(async (path, options) => {
    calls.push({ path, options });
    return response(
      path === "/api/assistant"
        ? {
            reply: "Choose who does it.",
            action: {
              kind: "chore_create",
              title: "Recycling",
              frequency: "weekly",
              weekdays: [1, 4],
              points: 10,
              difficulty: "easy",
            },
          }
        : path === "/api/family/members"
          ? { members: [{ id: "member-a", name: "Avery" }] }
          : { chore: { id: "c" } },
    );
  }) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(
    screen.getByLabelText("Your message"),
    "Add recycling Mondays and Thursdays",
  );
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Chore assignee");
  expect(
    screen.getByRole("button", { name: "Confirm and save" }),
  ).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Chore assignee"), "member-a");
  expect(
    screen.getByRole("button", { name: "Confirm and save" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Confirm and save" }));
  await screen.findByText("Saved “Recycling”.");
  expect(calls[2].path).toBe("/api/chores/create");
  expect(JSON.parse(calls[2].options.body).assigned_to).toBe("member-a");
});

it("localizes the shell, report and voice copy while retaining an unsent draft", async () => {
  const user = userEvent.setup();
  function LocaleSwitcher() {
    const { setLocale } = useTranslation();
    return (
      <button type="button" onClick={() => setLocale("es")}>
        Cambiar idioma
      </button>
    );
  }
  render(
    <I18nProvider locale="en">
      <LocaleSwitcher />
      <AssistantHost role="parent" />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  const message = within(dialog).getByLabelText("Your message");
  await user.type(message, "Keep this unsent");
  await user.click(screen.getByRole("button", { name: "Cambiar idioma" }));

  expect(
    within(dialog).getByRole("heading", { name: "Asistente de IA" }),
  ).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Tu mensaje")).toHaveValue(
    "Keep this unsent",
  );
  expect(
    within(dialog).getByRole("button", { name: "Entrada de voz" }),
  ).toBeDisabled();
  expect(dialog).toHaveTextContent(
    "La voz no está disponible en este navegador; puedes escribir.",
  );

  await user.click(
    within(dialog).getByRole("button", { name: "Informar / Sugerir" }),
  );
  expect(
    within(dialog).getByRole("heading", {
      name: "Informar de un error o sugerir una función",
    }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByLabelText("¿Qué ocurrió o qué ayudaría?"),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Guardar informe" }),
  ).toBeInTheDocument();
});

it("localizes the proposed-action review without translating generated titles", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(async (path) =>
    response(
      path === "/api/assistant"
        ? {
            reply: "Review this list.",
            action: {
              kind: "list_create",
              title: "Weekend trip",
              type: "custom",
            },
          }
        : { list: { id: "l" } },
    ),
  ) as any;
  render(
    <I18nProvider locale="es">
      <AssistantHost role="parent" />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Asistente de IA" }));
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Tu mensaje"),
    "Crea una lista",
  );
  await user.click(within(dialog).getByRole("button", { name: "Enviar" }));
  const review = await within(dialog).findByRole("region", {
    name: "Revisar acción propuesta",
  });
  expect(within(review).getByLabelText("Título propuesto")).toHaveValue(
    "Weekend trip",
  );
  expect(
    within(review).getByRole("button", { name: "Confirmar y guardar" }),
  ).toBeInTheDocument();
  expect(
    within(review).getByRole("button", { name: "Cancelar propuesta" }),
  ).toBeInTheDocument();
});

it("localizes semantic voice errors without changing recognition behavior", async () => {
  class Recognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: any;
    onerror: any;
    onend: any;
    start = jest.fn();
    abort = jest.fn();
    constructor() {
      mockRecognition = this;
    }
  }
  (window as any).SpeechRecognition = Recognition;
  const user = userEvent.setup();
  render(
    <I18nProvider locale="es">
      <AssistantHost role="parent" />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Asistente de IA" }));
  await user.click(screen.getByRole("button", { name: "Entrada de voz" }));
  const { act } = require("@testing-library/react");
  act(() => mockRecognition.onerror({ error: "not-allowed" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Se denegó el acceso al micrófono. Aún puedes escribir.",
  );
});

it("localizes weekly action review controls and weekday choices", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(async (path) =>
    response(
      path === "/api/assistant"
        ? {
            reply: "Choose the weekly days.",
            action: {
              kind: "chore_create",
              title: "Recycling",
              frequency: "weekly",
              weekdays: [1, 4],
              points: 10,
              difficulty: "easy",
            },
          }
        : { members: [{ id: "member-a", name: "Avery" }] },
    ),
  ) as any;
  render(
    <I18nProvider locale="es">
      <AssistantHost role="parent" />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Asistente de IA" }));
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Tu mensaje"),
    "Añade reciclaje",
  );
  await user.click(within(dialog).getByRole("button", { name: "Enviar" }));
  expect(await within(dialog).findByText("Repetir los")).toBeInTheDocument();
  expect(
    within(dialog).getByText("Elige uno o más días de cada semana."),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("checkbox", { name: "Lunes" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("checkbox", { name: "Jueves" }),
  ).toBeInTheDocument();
});

it("re-localizes a static action failure after switching language", async () => {
  const user = userEvent.setup();
  function LocaleSwitcher() {
    const { setLocale } = useTranslation();
    return (
      <button type="button" onClick={() => setLocale("es")}>
        Cambiar idioma
      </button>
    );
  }
  global.fetch = jest.fn(async () =>
    response({
      reply: "Review the event time.",
      action: {
        kind: "event_create",
        title: "Pickup",
        start: "2026-10-10T15:00",
        end: "2026-10-10T14:00",
      },
    }),
  ) as any;
  render(
    <I18nProvider locale="en">
      <LocaleSwitcher />
      <AssistantHost role="parent" />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Your message"), "Add pickup");
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  await user.click(
    within(dialog).getByRole("button", { name: "Confirm and save" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Choose a valid start and later end time.",
  );
  await user.click(screen.getByRole("button", { name: "Cambiar idioma" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Elige un inicio válido y una hora de finalización posterior.",
  );
});

it("keeps an invalid event proposal editable without POST, then writes only after correction", async () => {
  const user = userEvent.setup();
  const calls: string[] = [];
  global.fetch = jest.fn(async (path) => {
    calls.push(String(path));
    if (path === "/api/assistant")
      return response({
        reply: "Review the event time.",
        action: {
          kind: "event_create",
          title: "Pickup",
          start: "2026-10-10T15:00",
          end: "2026-10-10T14:00",
        },
      });
    return response({ event: { id: "event-a" } });
  }) as any;

  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Your message"), "Add pickup");
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  const proposal = await within(dialog).findByRole("region", {
    name: "Review proposed action",
  });
  await user.click(
    within(proposal).getByRole("button", { name: "Confirm and save" }),
  );
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Choose a valid start and later end time.",
  );
  expect(
    within(dialog).getByRole("region", { name: "Review proposed action" }),
  ).toBeInTheDocument();
  expect(calls).toEqual(["/api/assistant"]);

  const end = within(proposal).getByLabelText("Proposed end");
  fireEvent.change(end, { target: { value: "2026-10-10T15:30" } });
  await user.click(within(proposal).getByRole("button", { name: "Confirm and save" }));
  await within(dialog).findByText("Saved “Pickup”.");
  expect(calls).toEqual(["/api/assistant", "/api/events"]);
});

it("sends an explicit Include Today choice and keeps the draft on an unavailable response", async () => {
  const user = userEvent.setup();
  const calls: any[] = [];
  global.fetch = jest.fn(async (path, options) => {
    calls.push({ path, options });
    return response(
      {
        error: "Today context is unavailable.",
        code: "ASSISTANT_TODAY_UNAVAILABLE",
      },
      false,
    );
  }) as any;
  render(<AssistantHost role="parent" todayContextEnabled />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("checkbox", { name: /Include Today/i }),
  );
  const draft = "What is on today?";
  await user.type(within(dialog).getByLabelText("Your message"), draft);
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0].options.body).includeToday).toBe(true);
  expect(within(dialog).getByLabelText("Your message")).toHaveValue(draft);
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Today context is unavailable right now.",
  );
});

it("discloses the Today provider payload in both locales and tracks the opt-in state", async () => {
  const user = userEvent.setup();
  function LocaleSwitcher() {
    const { setLocale } = useTranslation();
    return (
      <button type="button" onClick={() => setLocale("es")}>
        Cambiar idioma
      </button>
    );
  }

  render(
    <I18nProvider locale="en">
      <LocaleSwitcher />
      <AssistantHost role="parent" todayContextEnabled />
    </I18nProvider>,
  );
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("Household records are not attached.");
  expect(dialog).toHaveTextContent(
    "When selected, this request sends a short, read-only summary of today’s events, chores, dinner, groceries and food items marked to use soon to your household’s configured AI provider.",
  );

  await user.click(
    within(dialog).getByRole("checkbox", { name: /Include Today/i }),
  );
  expect(dialog).not.toHaveTextContent("Household records are not attached.");
  expect(dialog).toHaveTextContent(
    "Include Today is on: this request sends a short, read-only summary of today’s events, chores, dinner, groceries and food items marked to use soon to your household’s configured AI provider.",
  );

  await user.click(screen.getByRole("button", { name: "Cambiar idioma" }));
  expect(dialog).toHaveTextContent(
    "Incluir Hoy está activado: esta solicitud envía un resumen breve y de solo lectura de los eventos, tareas, cena, compras y alimentos marcados para usar pronto al proveedor de IA configurado para tu hogar.",
  );
  await user.click(
    within(dialog).getByRole("checkbox", { name: /Incluir Hoy/i }),
  );
  expect(dialog).toHaveTextContent("No se adjuntan registros del hogar.");
});

it("blocks an expired Today action until an explicit fresh preview", async () => {
  const user = userEvent.setup();
  let calls = 0,
    now = 1_000;
  const expiredGenerated = new Date().toISOString();
  const expired = {
    "X-Assistant-Today-Protocol": "herewoven.assistant-today.v1",
    "X-Assistant-Today-Generated-At": expiredGenerated,
    "X-Assistant-Today-Expires-At": new Date(
      Date.parse(expiredGenerated) + 60_000,
    ).toISOString(),
  };
  const fresh = {
    "X-Assistant-Today-Protocol": "herewoven.assistant-today.v1",
    "X-Assistant-Today-Generated-At": new Date().toISOString(),
    "X-Assistant-Today-Expires-At": new Date(Date.now() + 60_000).toISOString(),
  };
  global.fetch = jest.fn(async () => {
    calls += 1;
    const result = response(
      {
        reply: "Review this list.",
        action: { kind: "list_create", title: "Trip", type: "custom" },
      },
      true,
      calls === 1 ? expired : fresh,
    );
    if (calls === 1) {
      return {
        ...result,
        json: async () => {
          now = 1_001;
          return result.json();
        },
      };
    }
    return result;
  }) as any;
  render(<AssistantHost role="parent" todayContextEnabled />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("checkbox", { name: /Include Today/i }),
  );
  await user.type(
    within(dialog).getByLabelText("Your message"),
    "Plan a trip list",
  );
  const performanceSpy = jest
    .spyOn(performance, "now")
    .mockImplementation(() => now);
  try {
    fireEvent.submit(
      within(dialog).getByRole("button", { name: "Send" }).closest("form")!,
    );
    const confirm = await within(dialog).findByRole("button", {
      name: "Confirm and save",
    });
    now = 61_001;
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(
      within(dialog).getByText(/Today context has expired/i),
    ).toBeInTheDocument();
    const newerDraft = "Keep this newer draft";
    await user.type(within(dialog).getByLabelText("Your message"), newerDraft);
    await user.click(
      within(dialog).getByRole("button", { name: "Refresh Today context" }),
    );
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "Confirm and save" }),
      ).toBeEnabled(),
    );
    expect(within(dialog).getByLabelText("Your message")).toHaveValue(
      newerDraft,
    );
    expect(calls).toBe(2);
  } finally {
    performanceSpy.mockRestore();
  }
});

it("fails closed for a noncanonical or overlong freshness lease", async () => {
  const user = userEvent.setup();
  const generated = new Date().toISOString();
  global.fetch = jest.fn(async () =>
    response(
      {
        reply: "Review this list.",
        action: { kind: "list_create", title: "Trip", type: "custom" },
      },
      true,
      {
        "X-Assistant-Today-Protocol": "wrong.protocol",
        "X-Assistant-Today-Generated-At": generated,
        "X-Assistant-Today-Expires-At": new Date(
          Date.parse(generated) + 60_001,
        ).toISOString(),
      },
    ),
  ) as any;
  render(<AssistantHost role="parent" todayContextEnabled />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("checkbox", { name: /Include Today/i }),
  );
  await user.type(within(dialog).getByLabelText("Your message"), "Plan a list");
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "Today context is unavailable right now.",
  );
  expect(within(dialog).queryByRole("region")).toBeNull();
});

it("expires a Today preview when the tab backgrounds before confirmation", async () => {
  const user = userEvent.setup();
  const generated = new Date().toISOString();
  global.fetch = jest.fn(async () =>
    response(
      {
        reply: "Review this list.",
        action: { kind: "list_create", title: "Trip", type: "custom" },
      },
      true,
      {
        "X-Assistant-Today-Protocol": "herewoven.assistant-today.v1",
        "X-Assistant-Today-Generated-At": generated,
        "X-Assistant-Today-Expires-At": new Date(
          Date.parse(generated) + 30_000,
        ).toISOString(),
      },
    ),
  ) as any;
  render(<AssistantHost role="parent" todayContextEnabled />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("checkbox", { name: /Include Today/i }),
  );
  await user.type(within(dialog).getByLabelText("Your message"), "Plan a list");
  await user.click(within(dialog).getByRole("button", { name: "Send" }));
  const confirm = await within(dialog).findByRole("button", {
    name: "Confirm and save",
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  const originalVisibility = Object.getOwnPropertyDescriptor(
    document,
    "visibilityState",
  );
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  fireEvent(document, new Event("visibilitychange"));
  await waitFor(() => expect(confirm).toBeDisabled());
  expect(
    within(dialog).getByText(/Today context has expired/i),
  ).toBeInTheDocument();
  if (originalVisibility) {
    Object.defineProperty(document, "visibilityState", originalVisibility);
  } else {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  }
});

it("fails closed when the monotonic lease clock moves backwards", async () => {
  const user = userEvent.setup();
  const generated = new Date().toISOString();
  const performanceSpy = jest.spyOn(performance, "now").mockReturnValue(1_000);
  global.fetch = jest.fn(async () =>
    response(
      {
        reply: "Review this list.",
        action: { kind: "list_create", title: "Trip", type: "custom" },
      },
      true,
      {
        "X-Assistant-Today-Protocol": "herewoven.assistant-today.v1",
        "X-Assistant-Today-Generated-At": generated,
        "X-Assistant-Today-Expires-At": new Date(
          Date.parse(generated) + 30_000,
        ).toISOString(),
      },
    ),
  ) as any;
  try {
    render(<AssistantHost role="parent" todayContextEnabled />);
    await user.click(screen.getByRole("button", { name: "AI assistant" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("checkbox", { name: /Include Today/i }),
    );
    await user.type(
      within(dialog).getByLabelText("Your message"),
      "Plan a list",
    );
    await user.click(within(dialog).getByRole("button", { name: "Send" }));
    const confirm = await within(dialog).findByRole("button", {
      name: "Confirm and save",
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    performanceSpy.mockReturnValue(900);
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(
      within(dialog).getByText(/Today context has expired/i),
    ).toBeInTheDocument();
  } finally {
    performanceSpy.mockRestore();
  }
});

it("rejects a Today response that arrives after the request-start lease", async () => {
  const user = userEvent.setup();
  const generated = new Date().toISOString();
  global.fetch = jest.fn(async () =>
    response(
      {
        reply: "Review this list.",
        action: { kind: "list_create", title: "Trip", type: "custom" },
      },
      true,
      {
        "X-Assistant-Today-Protocol": "herewoven.assistant-today.v1",
        "X-Assistant-Today-Generated-At": generated,
        "X-Assistant-Today-Expires-At": new Date(
          Date.parse(generated) + 60_000,
        ).toISOString(),
      },
    ),
  ) as any;
  render(<AssistantHost role="parent" todayContextEnabled />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("checkbox", { name: /Include Today/i }),
  );
  const draft = "Plan a list";
  await user.type(within(dialog).getByLabelText("Your message"), draft);
  const performanceSpy = jest
    .spyOn(performance, "now")
    .mockReturnValueOnce(1_000)
    .mockReturnValueOnce(61_001)
    .mockReturnValue(61_001);
  try {
    fireEvent.submit(
      within(dialog).getByRole("button", { name: "Send" }).closest("form")!,
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Today context is unavailable right now.",
    );
    expect(within(dialog).getByLabelText("Your message")).toHaveValue(draft);
    expect(within(dialog).queryByRole("region")).toBeNull();
  } finally {
    performanceSpy.mockRestore();
  }
});
