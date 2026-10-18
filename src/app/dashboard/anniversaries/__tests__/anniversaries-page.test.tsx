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
  can_edit: true,
  can_delete: true,
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
    global.fetch = jest.fn().mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      })
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
      headers: {
        "Idempotency-Key": expect.stringMatching(/^[A-Za-z0-9_-]{16,128}$/),
      },
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
    let resolvePatch: (value: {
      ok: boolean;
      status: number;
      json?: () => Promise<unknown>;
    }) => void = () => undefined;
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
    for (const label of ["Name", "Type", "Date", "Notes (optional)"]) {
      expect(within(edit).getByLabelText(label)).toBeDisabled();
    }
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

    resolvePatch({
      ok: true,
      status: 200,
      json: async () => ({
        date: {
          id: "date-1",
          name: "Updated Grandma",
          type: "birthday",
          date: "2099-04-10",
          notes: "Private note",
        },
      }),
    });
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      })
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

    expect(
      await screen.findByText(
        "Date removed. The list could not be refreshed; try again to check it.",
      ),
    ).toBeInTheDocument();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    const retry = screen.getByRole("button", { name: "Try again" });
    expect(retry).toHaveFocus();
    expect(retry).toHaveClass("min-h-[44px]", "min-w-[44px]");
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        "Date removed. The list could not be refreshed; try again to check it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Could not load dates")).not.toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    expect(
      (global.fetch as jest.Mock).mock.calls.filter(
        (call) => call[1]?.method === "DELETE",
      ),
    ).toHaveLength(1);
  });

  it("localizes the page-level load recovery action", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
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
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      })
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

describe("/dashboard/anniversaries recovery", () => {
  it("uses a stable receipt key and canonical body when a create response is lost", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [] }),
      })
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          date: {
            id: "new-date",
            name: "New date",
            type: "birthday",
            date: "2099-04-10",
            notes: null,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          dates: [
            {
              ...date,
              id: "new-date",
              name: "New date",
              notes: null,
            },
          ],
        }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Add Date" }));
    const add = screen.getByRole("dialog", { name: "Add Date" });
    await user.type(within(add).getByLabelText("Name"), " New date ");
    await user.type(within(add).getByLabelText("Date"), "2099-04-10");
    await user.click(within(add).getByRole("button", { name: "Save" }));
    expect(await within(add).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );
    await user.click(within(add).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const posts = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1]?.method === "POST",
    );
    expect(posts).toHaveLength(2);
    expect(posts[0][1].headers["Idempotency-Key"]).toMatch(
      /^[A-Za-z0-9_-]{16,128}$/,
    );
    expect(posts[1][1].headers["Idempotency-Key"]).toBe(
      posts[0][1].headers["Idempotency-Key"],
    );
    expect(posts[1][1].body).toBe(posts[0][1].body);
    expect(JSON.parse(posts[0][1].body)).toMatchObject({
      name: "New date",
      notes: null,
    });
  });

  it("reuses a save key after a network failure and starts a new key when the draft changes", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: {
            id: "date-1",
            name: "Updated Grandma",
            type: "birthday",
            date: "2099-04-10",
            notes: "Private note",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [{ ...date, name: "Updated Grandma" }] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    const name = within(edit).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Grandma");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );

    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );

    await user.clear(name);
    await user.type(name, "Updated Grandma");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(5));

    const patches = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1]?.method === "PATCH",
    );
    expect(patches).toHaveLength(3);
    const firstKey = patches[0][1].headers["Idempotency-Key"];
    expect(firstKey).toMatch(/^[A-Za-z0-9_-]{16,128}$/);
    expect(patches[1][1].headers["Idempotency-Key"]).toBe(firstKey);
    expect(patches[1][1].body).toBe(patches[0][1].body);
    expect(patches[2][1].headers["Idempotency-Key"]).not.toBe(firstKey);
    expect(patches[2][1].body).not.toBe(patches[0][1].body);
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the original receipt key when a draft returns from A to B to A", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: {
            id: "date-1",
            name: "Grandma A",
            type: "birthday",
            date: "2099-04-10",
            notes: "Private note",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [{ ...date, name: "Grandma A" }] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    const name = within(edit).getByLabelText("Name");

    await user.clear(name);
    await user.type(name, "Grandma A");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );

    await user.clear(name);
    await user.type(name, "Grandma B");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );

    await user.clear(name);
    await user.type(name, "Grandma A");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(5));

    const patches = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1]?.method === "PATCH",
    );
    expect(patches).toHaveLength(3);
    expect(patches[0][1].headers["Idempotency-Key"]).toBe(
      patches[2][1].headers["Idempotency-Key"],
    );
    expect(patches[0][1].body).toBe(patches[2][1].body);
    expect(patches[1][1].headers["Idempotency-Key"]).not.toBe(
      patches[0][1].headers["Idempotency-Key"],
    );
    expect(patches[1][1].body).not.toBe(patches[0][1].body);
  });

  it("cancels only the active draft and preserves an earlier uncertain receipt", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: {
            id: "date-1",
            name: "Grandma A",
            type: "birthday",
            date: "2099-04-10",
            notes: "Private note",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [{ ...date, name: "Grandma A" }] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    let edit = screen.getByRole("dialog", { name: "Edit" });
    let name = within(edit).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Grandma A");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );

    await user.clear(name);
    await user.type(name, "Grandma B");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "The date could not be saved. Check your connection and try again.",
    );

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    edit = screen.getByRole("dialog", { name: "Edit" });
    name = within(edit).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Grandma A");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(5));

    const patches = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1]?.method === "PATCH",
    );
    expect(patches).toHaveLength(3);
    expect(patches[0][1].headers["Idempotency-Key"]).toBe(
      patches[2][1].headers["Idempotency-Key"],
    );
    expect(patches[1][1].headers["Idempotency-Key"]).not.toBe(
      patches[0][1].headers["Idempotency-Key"],
    );
    expect(patches[0][1].body).toBe(patches[2][1].body);
  });

  it("retries an in-progress 409 with the same body and receipt key", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: "IDEMPOTENCY_IN_PROGRESS",
            message: "Please retry this date.",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: {
            id: "date-1",
            name: "Grandma",
            type: "birthday",
            date: "2099-04-10",
            notes: "Private note",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "Please retry this date.",
    );
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

    const patches = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1]?.method === "PATCH",
    );
    expect(patches[1][1].headers["Idempotency-Key"]).toBe(
      patches[0][1].headers["Idempotency-Key"],
    );
    expect(patches[1][1].body).toBe(patches[0][1].body);
  });

  it("keeps the draft and receipt key after a malformed 2xx until a retry is confirmed", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ date: { id: "date-1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: {
            id: "date-1",
            name: "Grandma",
            type: "birthday",
            date: "2099-04-10",
            notes: "Private note",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    const name = within(edit).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Grandma");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "We couldn't confirm the date was saved. Try again.",
    );
    expect(name).toHaveValue("Grandma");

    await user.click(within(edit).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
    const patches = (global.fetch as jest.Mock).mock.calls.filter(
      (call) => call[1]?.method === "PATCH",
    );
    expect(patches[1][1].headers["Idempotency-Key"]).toBe(
      patches[0][1].headers["Idempotency-Key"],
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("announces a confirmed save when the GET refresh fails and retries only the read", async () => {
    const user = userEvent.setup();
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [date] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          date: {
            id: "date-1",
            name: "Updated Grandma",
            type: "birthday",
            date: "2099-04-10",
            notes: "Private note",
          },
        }),
      })
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ dates: [{ ...date, name: "Updated Grandma" }] }),
      }) as unknown as typeof fetch;
    renderPage();

    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    const name = within(edit).getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Updated Grandma");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(
        "Date saved. The list could not be refreshed; try again to check it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Could not load dates")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Edit" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        screen.queryByText(/The list could not be refreshed/),
      ).not.toBeInTheDocument(),
    );
    expect(
      (global.fetch as jest.Mock).mock.calls.filter(
        (call) => call[1]?.method === "PATCH",
      ),
    ).toHaveLength(1);
  });

  it.each([
    { role: "parent", canEdit: true, canDelete: true },
    { role: "teen", canEdit: false, canDelete: false },
  ])(
    "uses server grants for a $role create even when the refresh fails",
    async ({ canEdit, canDelete }) => {
      const user = userEvent.setup();
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ dates: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          json: async () => ({
            date: {
              id: "created-date",
              name: "Created date",
              type: "birthday",
              date: "2099-04-10",
              notes: null,
              can_edit: canEdit,
              can_delete: canDelete,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
        }) as unknown as typeof fetch;
      renderPage();

      await user.click(await screen.findByRole("button", { name: "Add Date" }));
      const add = screen.getByRole("dialog", { name: "Add Date" });
      await user.type(within(add).getByLabelText("Name"), "Created date");
      await user.type(within(add).getByLabelText("Date"), "2099-04-10");
      await user.click(within(add).getByRole("button", { name: "Save" }));
      expect(
        await screen.findByText(
          "Date saved. The list could not be refreshed; try again to check it.",
        ),
      ).toBeInTheDocument();

      await user.click(screen.getByText("More dates (1)"));
      const row = await screen.findByRole("button", { name: /Created date/ });
      await user.click(row);

      if (canEdit) {
        const edit = screen.getByRole("dialog", { name: "Edit" });
        expect(
          within(edit).getByRole("button", { name: "Save" }),
        ).toBeEnabled();
        expect(
          within(edit).getByRole("button", { name: "Delete" }),
        ).toBeInTheDocument();
      } else {
        const detail = screen.getByRole("dialog", { name: "Created date" });
        expect(
          within(detail).queryByRole("button", { name: "Save" }),
        ).not.toBeInTheDocument();
        expect(
          within(detail).queryByRole("button", { name: "Delete" }),
        ).not.toBeInTheDocument();
      }
    },
  );
});

describe("approved Dates overview", () => {
  function mockDates(dates: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ dates }),
    }) as unknown as typeof fetch;
  }

  it("opens a read-only detail when there is no server edit grant", async () => {
    const user = userEvent.setup();
    mockDates([{ ...date, can_edit: false, can_delete: false }]);
    renderPage();
    const opener = await screen.findByRole("button", { name: /Grandma/ });
    await user.click(opener);
    const detail = screen.getByRole("dialog", { name: "Grandma" });
    expect(detail).toHaveTextContent("Private note");
    expect(within(detail).queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      within(detail).queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      within(detail).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("lets an own-record editor save without exposing parent-only deletion", async () => {
    const user = userEvent.setup();
    mockDates([{ ...date, can_edit: true, can_delete: false }]);
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Edit" });
    expect(within(edit).getByRole("button", { name: "Save" })).toBeEnabled();
    expect(
      within(edit).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("treats missing legacy permission metadata as read-only", async () => {
    const { can_edit, can_delete, ...legacy } = date;
    mockDates([legacy]);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    expect(screen.getByRole("dialog", { name: "Grandma" })).toHaveTextContent(
      "Private note",
    );
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("uses Spanish dates and a localized short form with optional details", async () => {
    const user = userEvent.setup();
    mockDates([date]);
    renderPage("es");
    await user.click(await screen.findByRole("button", { name: /Grandma/ }));
    const edit = screen.getByRole("dialog", { name: "Editar" });
    expect(
      within(edit).getByPlaceholderText("p. ej., Emma Johnson"),
    ).toHaveValue("Grandma");
    expect(within(edit).getByText("Detalles opcionales")).toBeInTheDocument();
    expect(
      within(edit).getByRole("button", { name: "Cerrar detalles de la fecha" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /Grandma/ })).toHaveTextContent(
      /abril/,
    );
  });

  it.each([
    null,
    {},
    [{ ...date, id: null }],
    [date, date],
    [{ ...date, date: "2099-02-31" }],
  ])(
    "shows recovery rather than false empty data for malformed success %p",
    async (dates) => {
      mockDates(dates);
      renderPage();
      expect(
        await screen.findByText("Could not load dates"),
      ).toBeInTheDocument();
      expect(screen.queryByText("No dates yet")).not.toBeInTheDocument();
    },
  );

  it("combines all date types chronologically and folds later dates", async () => {
    const now = new Date();
    const calendar = (days: number) => {
      const value = new Date(now);
      value.setDate(now.getDate() + days);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    };
    mockDates([
      { ...date, id: "later", name: "Later birthday", date: calendar(150) },
      {
        ...date,
        id: "second",
        name: "Second anniversary",
        type: "anniversary",
        date: calendar(2),
      },
      {
        ...date,
        id: "first",
        name: "First custom",
        type: "custom",
        date: calendar(1),
      },
    ]);
    renderPage();
    const upcoming = await screen.findByRole("region", { name: "Next up" });
    expect(
      within(upcoming)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining("First custom"),
      expect.stringContaining("Second anniversary"),
    ]);
    const later = screen.getByText("More dates (1)").closest("details");
    expect(later).not.toHaveAttribute("open");
    expect(later).toHaveTextContent("Later birthday");
  });

  it("has a single Add action in the empty state", async () => {
    mockDates([]);
    renderPage();
    await screen.findByText("No dates yet");
    expect(screen.getAllByRole("button", { name: "Add Date" })).toHaveLength(1);
  });
});
