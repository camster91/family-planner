/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { I18nProvider } from "@/i18n";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeleteListButton from "../DeleteListButton";

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

function renderButton(locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <DeleteListButton listId="list-1" listName="Family groceries" />
    </I18nProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    value: "csrf_token=csrf-123",
  });
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("DeleteListButton", () => {
  it("opens a named confirmation, focuses Cancel, and performs no write when cancelled", async () => {
    const user = userEvent.setup();
    renderButton();
    const trigger = screen.getByRole("button", {
      name: "Delete list “Family groceries”",
    });

    await user.click(trigger);

    const dialog = screen.getByRole("alertdialog", {
      name: "Delete “Family groceries”?",
    });
    expect(dialog).toHaveTextContent(
      "This permanently deletes “Family groceries” and all of its items.",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends the canonical DELETE payload and csrf header, then preserves navigation", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    renderButton();

    await user.click(
      screen.getByRole("button", { name: "Delete list “Family groceries”" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    expect(global.fetch).toHaveBeenCalledWith("/api/lists", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-123",
      },
      body: JSON.stringify({ listId: "list-1" }),
    });
    expect(mockPush).toHaveBeenCalledWith("/dashboard/lists");
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open with safe retry copy after a refused delete", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        json: async () => ({ error: "sensitive internal detail" }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    renderButton();

    await user.click(
      screen.getByRole("button", { name: "Delete list “Family groceries”" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The list could not be deleted. Try again.",
    );
    expect(alert).not.toHaveTextContent("sensitive internal detail");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    expect(mockPush).toHaveBeenCalledWith("/dashboard/lists");
  });

  it("keeps Escape and close controls inert while a delete is in flight", async () => {
    const user = userEvent.setup();
    let resolveRequest: (value: { ok: boolean; status: number }) => void = () =>
      undefined;
    (global.fetch as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    renderButton();

    await user.click(
      screen.getByRole("button", { name: "Delete list “Family groceries”" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Deleting…" }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "Close delete confirmation" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    resolveRequest({ ok: false, status: 503 });
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("uses the localized confirmation and recovery copy", async () => {
    const user = userEvent.setup();
    (global.fetch as jest.Mock).mockRejectedValue(new Error("offline"));
    renderButton("es");

    await user.click(
      screen.getByRole("button", { name: "Eliminar lista “Family groceries”" }),
    );
    expect(
      screen.getByRole("alertdialog", {
        name: "¿Eliminar “Family groceries”?",
      }),
    ).toHaveTextContent(
      "Esto eliminará permanentemente “Family groceries” y todos sus elementos.",
    );
    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No se pudo eliminar la lista. Revisa tu conexión e inténtalo de nuevo.",
    );
  });
});
