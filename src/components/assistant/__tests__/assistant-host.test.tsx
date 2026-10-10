/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const response = (data: unknown, ok = true) => ({ ok, json: async () => data });
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
        : { lists: [{ id: "l", name: "Trip" }] },
    );
  }) as any;
  render(<AssistantHost role="parent" />);
  await user.click(screen.getByRole("button", { name: "AI assistant" }));
  await user.type(screen.getByLabelText("Your message"), "Remove Trip");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByLabelText("Item to remove");
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
    "pb-[calc(max(1rem,var(--phone-tab-bar-height,0px))+env(safe-area-inset-bottom,0px)+1rem)]",
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
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
