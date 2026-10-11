/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import AnniversariesPage from "../page";

jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));

const date = {
  id: "date-1",
  name: "Grandma",
  type: "birthday" as const,
  date: "2099-04-10",
  notes: "Private note",
  days_until: 10,
  next_occurrence: "2099-04-10",
};

function renderPage(locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <AnniversariesPage />
    </I18nProvider>,
  );
}

describe("/dashboard/anniversaries destructive removal", () => {
  it("opens a named alertdialog, focuses Cancel, preserves an edit draft, and does not write when cancelled", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    const name = within(edit).getByLabelText("Name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Draft Grandma");
    await user.click(within(edit).getByRole("button", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog", {
      name: "Remove “Grandma”?",
    });
    expect(dialog).toHaveTextContent(
      "This permanently removes “Grandma” from the family dates.",
    );
    expect(dialog).not.toHaveTextContent("Private note");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(edit).getByLabelText("Name")).toHaveValue("Draft Grandma");
    expect(within(edit).getByRole("button", { name: "Delete" })).toHaveFocus();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the path-only DELETE contract, keeps the edit dialog private, and restores focus after success", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    await user.click(within(edit).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove “Grandma”?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect(global.fetch).toHaveBeenCalledWith("/api/anniversaries/date-1", {
      method: "DELETE",
    });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    expect(
      screen.getAllByRole("button", { name: "Add Date" })[0],
    ).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("blocks edit close and delete while a PATCH is pending, preserving focus inside the draft", async () => {
    const user = userEvent.setup();
    let resolvePatch: (value: { ok: boolean; status: number }) => void = () =>
      undefined;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
      )
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    const name = within(edit).getByLabelText("Name") as HTMLInputElement;
    await user.clear(name);
    await user.type(name, "Updated Grandma");
    await user.click(within(edit).getByRole("button", { name: "Save" }));

    const saving = within(edit).getByRole("button", { name: "Saving..." });
    expect(saving).toBeDisabled();
    expect(within(edit).getByRole("button", { name: "Delete" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    const editAfterEscape = screen.getByRole("dialog", {
      name: "Edit",
    }) as HTMLElement;
    expect(editAfterEscape).toContainElement(
      document.activeElement as HTMLElement,
    );
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/api/anniversaries/date-1"),
      expect.objectContaining({ method: "DELETE" }),
    );

    resolvePatch({ ok: true, status: 200 });
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("moves focus to the retry action when the post-delete refresh fails", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    await user.click(within(edit).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove “Grandma”?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText("Could not load dates")).toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveFocus();
    expect(retry).toHaveClass("min-h-[44px]", "min-w-[44px]");
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("localizes the page-level load recovery action", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      }) as unknown as typeof fetch;
    renderPage("es");

    expect(
      await screen.findByText("No se pudieron cargar las fechas"),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Intentar de nuevo" });
    expect(retry).toHaveClass("min-h-[44px]", "min-w-[44px]");
  });

  it("keeps the alertdialog open with localized retry copy after a refused delete", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockResolvedValueOnce({ ok: false, status: 403 })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [] }),
      }) as unknown as typeof fetch;
    renderPage("es");

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Editar" });
    await user.click(within(edit).getByRole("button", { name: "Eliminar" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "¿Quitar «Grandma»?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo quitar la fecha. Inténtalo de nuevo.",
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Intentar de nuevo" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("does not dismiss or duplicate a pending delete", async () => {
    const user = userEvent.setup();
    let resolveDelete: (value: { ok: boolean; status: number }) => void = () =>
      undefined;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
      ) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    await user.click(within(edit).getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog", {
      name: "Remove “Grandma”?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));

    const removing = screen.getByRole("button", { name: "Removing…" });
    expect(removing).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    await user.click(removing);
    expect(global.fetch).toHaveBeenCalledTimes(2);

    resolveDelete({ ok: false, status: 503 });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The date could not be removed. Try again.",
    );
  });
});
