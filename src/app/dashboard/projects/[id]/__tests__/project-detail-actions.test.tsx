/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import * as React from "react";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/ui/toast";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProjectDetailActions } from "../ProjectDetailActions";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

function renderActions(locale: "en" | "es" = "en", isParent = true) {
  return render(
    <I18nProvider locale={locale}>
      <ToastProvider>
        <ProjectDetailActions
          projectId="project-1"
          projectName="Kitchen renovation"
          projectStatus="active"
          isParent={isParent}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

function openDelete(
  user: ReturnType<typeof userEvent.setup>,
  locale: "en" | "es" = "en",
) {
  return user
    .click(
      screen.getByRole("button", {
        name: locale === "es" ? "Acciones" : "Actions",
      }),
    )
    .then(() =>
      user.click(
        screen.getByRole("menuitem", {
          name: locale === "es" ? "Eliminar" : "Delete",
        }),
      ),
    );
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

describe("ProjectDetailActions deletion", () => {
  it("keeps the action menu inside a narrow viewport at a right-edge trigger", async () => {
    const user = userEvent.setup();
    const previousWidth = window.innerWidth;
    const previousHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    try {
      renderActions();

      const trigger = screen.getByRole("button", { name: "Actions" });
      Object.defineProperty(trigger, "getBoundingClientRect", {
        configurable: true,
        value: () =>
          ({
            left: 320,
            right: 382,
            top: 100,
            bottom: 144,
            width: 62,
            height: 44,
          }) as DOMRect,
      });
      await user.click(trigger);

      const menu = screen.getByRole("menu", { name: "Project actions" });
      const left = Number.parseFloat(menu.style.left);
      expect(left).toBeGreaterThanOrEqual(8);
      expect(left + 192).toBeLessThanOrEqual(window.innerWidth - 8);
      expect(menu.style.top).toBe("148px");
      expect(
        screen.getByRole("menuitem", { name: "Mark complete" }),
      ).toHaveFocus();
      await user.keyboard("{Escape}");
      // A wrapped header can put the trigger near the left edge as well.
      Object.defineProperty(trigger, "getBoundingClientRect", {
        configurable: true,
        value: () =>
          ({
            left: 60,
            right: 122,
            top: 100,
            bottom: 144,
            width: 62,
            height: 44,
          }) as DOMRect,
      });
      await user.click(trigger);
      const reopened = screen.getByRole("menu", { name: "Project actions" });
      expect(Number.parseFloat(reopened.style.left)).toBeGreaterThanOrEqual(8);
      expect(Number.parseFloat(reopened.style.left) + 192).toBeLessThanOrEqual(
        window.innerWidth - 8,
      );
      expect(
        screen.getByRole("menuitem", { name: "Mark complete" }),
      ).toHaveFocus();
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: previousWidth,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: previousHeight,
      });
    }
  });

  it("opens a project-named confirmation, focuses Cancel, and does not write when cancelled", async () => {
    const user = userEvent.setup();
    renderActions();

    await openDelete(user);

    const dialog = screen.getByRole("alertdialog", {
      name: "Delete “Kitchen renovation”?",
    });
    expect(dialog).toHaveTextContent(
      "This permanently deletes “Kitchen renovation” and all of its tasks. This cannot be undone.",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(screen.getByRole("button", { name: "Actions" })).toHaveFocus();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("preserves the canonical path-only DELETE and navigation on success", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    renderActions();

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith("/api/projects/project-1", {
      method: "DELETE",
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/projects");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the confirmation open with safe retry copy after a refused delete", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: "private server detail" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    renderActions();

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The project could not be deleted. Try again.",
    );
    expect(alert).not.toHaveTextContent("private server detail");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("keeps Escape and dismissal controls inert while a delete is in flight", async () => {
    const user = userEvent.setup();
    let resolveRequest: (value: { ok: boolean; status: number }) => void = () =>
      undefined;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderActions();

    await openDelete(user);
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const pendingSubmit = screen.getByRole("button", { name: "Deleting…" });
    expect(pendingSubmit).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: "Close project deletion confirmation",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(pendingSubmit);
    fireEvent.click(pendingSubmit);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    resolveRequest({ ok: false, status: 503 });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The project could not be deleted. Try again.",
    );
  });

  it("uses localized confirmation and recovery copy", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    renderActions("es");

    await openDelete(user, "es");
    expect(
      screen.getByRole("alertdialog", {
        name: "¿Eliminar «Kitchen renovation»?",
      }),
    ).toHaveTextContent(
      "Esto eliminará permanentemente «Kitchen renovation» y todas sus tareas. No se puede deshacer.",
    );

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo eliminar el proyecto. Revisa tu conexión e inténtalo de nuevo.",
    );

    await user.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    expect(await screen.findByText("Proyecto eliminado")).toBeInTheDocument();
  });

  it("does not expose destructive project actions to a non-parent", async () => {
    const user = userEvent.setup();
    renderActions("en", false);

    await user.click(screen.getByRole("button", { name: "Actions" }));

    expect(
      screen.queryByRole("menuitem", { name: "Delete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Mark complete" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Archive" }),
    ).not.toBeInTheDocument();
  });
});
