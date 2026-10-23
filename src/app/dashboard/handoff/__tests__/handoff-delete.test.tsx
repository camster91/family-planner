/**
 * @jest-environment jsdom
 */
import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { ToastProvider } from "@/components/ui/toast";

const translations: Record<string, string> = {
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.save": "Save",
  "common.saving": "Saving...",
  "routeState.tryAgain": "Try again",
  "handoff.title": "Babysitter handoff",
  "handoff.subtitle": "Quick sitter brief",
  "handoff.editHandoff": "Edit handoff",
  "handoff.createHandoff": "Create handoff",
  "handoff.deleteHandoff": "Delete handoff",
  "handoff.sitterName": "Sitter name",
  "handoff.sitterPhone": "Sitter phone",
  "handoff.arrivalTime": "Arrival time",
  "handoff.departureTime": "Departure time",
  "handoff.kidsBedtimes": "Kids' bedtimes",
  "handoff.whereSnacks": "Where snacks are",
  "handoff.pickupAuthorized": "Who can pick up",
  "handoff.codeWords": "Code words",
  "handoff.petCare": "Pet care",
  "handoff.emergencyNotes": "Emergency notes",
  "handoff.houseNotes": "House notes",
  "handoff.generalNotes": "General notes",
  "handoff.errorLoad": "Could not load",
  deleteTitle: "Remove “{name}”?",
  deleteDescription:
    "This permanently removes “{name}” and invalidates its shared sitter link.",
  deleteFailed: "The handoff could not be removed. Try again.",
  deleteNetworkError:
    "The handoff could not be removed. Check your connection and try again.",
  deleteClose: "Close handoff removal confirmation",
  deleting: "Removing…",
};

const mockT = (key: string, params?: Record<string, string | number>) => {
  const template = translations[key] ?? key;
  return Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template,
  );
};

jest.mock("@/i18n", () => ({
  useTranslation: () => ({ t: mockT, locale: "en" }),
}));
jest.mock("@/components/ui/feature-gate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import HandoffPage from "../page";

const handoff = {
  id: "h1",
  sitter_name: "Sarah",
  sitter_phone: "555-0100",
  arrival_time: null,
  departure_time: null,
  general_notes: "Private family note",
  share_token: "private-share-token",
  share_expires_at: "2099-01-01T00:00:00.000Z",
};

const otherHandoff = {
  ...handoff,
  id: "h2",
  sitter_name: "Mia",
  general_notes: null,
  share_token: "other-share-token",
};

const reply = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => body,
  }) as Response;

function renderPage() {
  return render(
    <ToastProvider>
      <HandoffPage />
    </ToastProvider>,
  );
}

function setupFetch({
  deleteHandler,
  refreshHandler,
  patchHandler,
}: {
  deleteHandler?: (init?: RequestInit) => Response | Promise<Response>;
  refreshHandler?: () => Response | Promise<Response>;
  patchHandler?: (init?: RequestInit) => Response | Promise<Response>;
} = {}) {
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url === "/api/auth/me")
        return reply({ user: { id: "p1", role: "parent" } });
      if (url === "/api/handoff" && method === "GET")
        return refreshHandler?.() ?? reply({ handoffs: [handoff] });
      if (url === "/api/handoff/h1" && method === "DELETE")
        return deleteHandler?.(init) ?? reply({ success: true });
      if (url === "/api/handoff/h1" && method === "PATCH")
        return patchHandler?.(init) ?? reply({ handoff });
      return reply({});
    },
  ) as unknown as typeof fetch;
}

async function openDelete(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Sarah");
  await user.click(screen.getAllByRole("button", { name: "Edit handoff" })[0]);
  const edit = screen.getByRole("dialog", { name: "Edit handoff" });
  await user.click(
    within(edit).getByRole("button", { name: "Delete handoff" }),
  );
  return {
    edit,
    dialog: screen.getByRole("alertdialog", { name: "Remove “Sarah”?" }),
  };
}

beforeEach(() => jest.restoreAllMocks());

describe("handoff destructive removal", () => {
  it("uses a named privacy-safe confirmation and preserves an edit draft on Cancel", async () => {
    const user = userEvent.setup();
    setupFetch();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Edit handoff" }),
    );
    const edit = screen.getByRole("dialog", { name: "Edit handoff" });
    const name = within(edit).getByLabelText("Sitter name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Draft Sarah");
    await user.click(
      within(edit).getByRole("button", { name: "Delete handoff" }),
    );
    const dialog = screen.getByRole("alertdialog", { name: "Remove “Sarah”?" });
    expect(dialog).toHaveTextContent(
      "This permanently removes “Sarah” and invalidates its shared sitter link.",
    );
    expect(dialog).not.toHaveTextContent("Private family note");
    expect(dialog).not.toHaveTextContent("private-share-token");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(edit).getByLabelText("Sitter name")).toHaveValue(
      "Draft Sarah",
    );
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/handoff/h1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("uses path-only DELETE, invalidates the public handoff, and restores focus after refresh", async () => {
    const user = userEvent.setup();
    let refreshes = 0;
    setupFetch({
      refreshHandler: () => {
        refreshes += 1;
        return refreshes === 1
          ? reply({ handoffs: [handoff] })
          : reply({ handoffs: [] });
      },
    });
    renderPage();

    const { dialog } = await openDelete(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit handoff" }),
      ).not.toBeInTheDocument(),
    );
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    expect(global.fetch).toHaveBeenCalledWith("/api/handoff/h1", {
      method: "DELETE",
    });
    expect(
      screen.getAllByRole("button", { name: "Create handoff" })[0],
    ).toHaveFocus();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps both dialogs locked and prevents duplicate DELETE while removal is pending", async () => {
    const user = userEvent.setup();
    let resolveDelete: (response: Response) => void = () => undefined;
    setupFetch({
      deleteHandler: () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
      refreshHandler: () => reply({ handoffs: [handoff] }),
    });
    renderPage();

    const { dialog } = await openDelete(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const removing = screen.getByRole("button", { name: "Removing…" });
    expect(removing).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      within(screen.getByRole("dialog", { name: "Edit handoff" })).getByRole(
        "button",
        { name: "Delete handoff" },
      ),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);

    resolveDelete(reply({ success: true }));
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("keeps refused removal recoverable without exposing server details", async () => {
    const user = userEvent.setup();
    let refused = true;
    let refreshes = 0;
    setupFetch({
      deleteHandler: () => {
        if (refused) {
          refused = false;
          return reply({ error: "private database detail" }, 403);
        }
        return reply({ success: true });
      },
      refreshHandler: () => {
        refreshes += 1;
        return refreshes === 1
          ? reply({ handoffs: [handoff] })
          : reply({ handoffs: [] });
      },
    });
    renderPage();

    const { dialog } = await openDelete(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(
      "The handoff could not be removed. Try again.",
    );
    expect(error).not.toHaveTextContent("private database detail");
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Try again",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
  });

  it("blocks delete and modal close while a PATCH save is pending", async () => {
    const user = userEvent.setup();
    let resolvePatch: (response: Response) => void = () => undefined;
    let refreshes = 0;
    setupFetch({
      patchHandler: () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
      refreshHandler: () => {
        refreshes += 1;
        return reply({ handoffs: [handoff] });
      },
    });
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "Edit handoff" }),
    );
    const edit = screen.getByRole("dialog", { name: "Edit handoff" });
    const name = within(edit).getByLabelText("Sitter name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Updated Sarah");
    await user.click(within(edit).getByRole("button", { name: "Save" }));

    expect(
      within(edit).getByRole("button", { name: "Saving..." }),
    ).toBeDisabled();
    expect(
      within(edit).getByRole("button", { name: "Delete handoff" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Edit handoff" }),
    ).toContainElement(document.activeElement as HTMLElement);
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/handoff/h1",
      expect.objectContaining({ method: "DELETE" }),
    );

    resolvePatch(reply({ handoff }));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Edit handoff" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("focuses page-level Retry when the post-delete refresh fails", async () => {
    const user = userEvent.setup();
    let refreshes = 0;
    setupFetch({
      refreshHandler: () => {
        refreshes += 1;
        return refreshes === 1
          ? reply({ handoffs: [handoff, otherHandoff] })
          : reply({ error: "offline" }, 503);
      },
    });
    renderPage();

    const { dialog } = await openDelete(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Could not load")).toBeInTheDocument();
    expect(screen.queryByTestId("handoff-card-h1")).not.toBeInTheDocument();
    expect(screen.getByTestId("handoff-card-h2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "handoff.shareWithSitter" }),
    ).toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Edit handoff" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
