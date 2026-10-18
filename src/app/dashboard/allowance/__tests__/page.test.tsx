/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import { render, screen, within, waitFor } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";
import AllowancePage from "../page";
import userEvent from "@testing-library/user-event";

const item = {
  id: "qa_allowance",
  amount: 12.5,
  status: "pending",
  from_user_id: "parent",
  to_user_id: "child",
  to_name: "Élodie",
  reason: "  Weekend – raw reason  ",
  paid_at: null,
};

jest.mock("@/components/providers/features-provider", () => ({
  useFeatureEnabled: () => true,
}));

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

function renderPage() {
  return render(
    <ToastProvider>
      <AllowancePage />
    </ToastProvider>,
  );
}

it("shows the parent-only Add link without mounting the creation form inline", async () => {
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/auth/me") return response({ user: { role: "parent" } });
    if (url === "/api/allowance") return response({ items: [] });
    return response({});
  }) as unknown as typeof fetch;

  renderPage();
  expect(await screen.findByRole("link", { name: "Add" })).toHaveAttribute(
    "href",
    "/dashboard/allowance/create",
  );
  expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
});

it("recovers a failed role lookup without exposing write controls to a teen", async () => {
  const user = userEvent.setup();
  let roleReads = 0;
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/auth/me") {
      roleReads += 1;
      return roleReads === 1
        ? response({ error: "unavailable" }, false, 503)
        : response({ user: { role: "teen" } });
    }
    return response({ items: [item] });
  }) as unknown as typeof fetch;
  renderPage();
  await screen.findByRole("alert");
  expect(screen.getByText("Weekend – raw reason")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel allowance" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(
    screen.getByText(
      "Your allowance: what you have coming and what has been paid.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Add" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Cancel allowance" })).toBeNull();
});

it("keeps cancellation deliberate, retryable and protected until a canonical receipt arrives", async () => {
  const user = userEvent.setup();
  let finish!: (response: Response) => void;
  const writes: unknown[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return response({ user: { role: "parent" } });
    if (init?.method === "PATCH") {
      writes.push(JSON.parse(init.body as string));
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return response({ items: [item] });
  }) as unknown as typeof fetch;
  renderPage();
  const opener = await screen.findByRole("button", {
    name: "Cancel allowance",
  });
  await user.click(opener);
  const first = screen.getByRole("alertdialog");
  await waitFor(() =>
    expect(
      within(first).getByRole("button", { name: "Keep allowance" }),
    ).toHaveFocus(),
  );
  await user.click(
    within(first).getByRole("button", { name: "Keep allowance" }),
  );
  expect(writes).toHaveLength(0);
  expect(opener).toHaveFocus();
  await user.click(opener);
  const dialog = screen.getByRole("alertdialog");
  await user.dblClick(
    within(dialog).getByRole("button", { name: "Cancel allowance" }),
  );
  expect(writes).toEqual([{ status: "cancelled" }]);
  await user.keyboard("{Escape}");
  expect(dialog).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Keep allowance" }),
  ).toBeDisabled();
  finish(response({ error: "refused" }, false, 503));
  await within(dialog).findByRole("alert");
  expect(within(dialog).getByText("Weekend – raw reason")).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Cancel allowance" }),
  );
  finish(
    response({ allowance: { ...item, id: "foreign", status: "cancelled" } }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Cancel allowance" }),
    ).toBeEnabled(),
  );
  expect(dialog).toBeInTheDocument();
  await user.click(
    within(dialog).getByRole("button", { name: "Cancel allowance" }),
  );
  finish(response({ allowance: { ...item, status: "cancelled" } }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Add" })).toHaveFocus(),
  );
  expect(screen.queryByRole("button", { name: "Cancel allowance" })).toBeNull();
  expect(screen.getByText("Cancelled (1)")).toBeInTheDocument();
  expect(writes).toHaveLength(3);
});

it("retains failed refresh recovery and closes when the server confirms an already completed cancellation", async () => {
  const user = userEvent.setup();
  let reads = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return response({ user: { role: "parent" } });
    if (init?.method === "PATCH") throw new Error("Response lost");
    reads += 1;
    if (reads === 2)
      return response({ error: "temporarily unavailable" }, false, 503);
    return response({
      items: [{ ...item, status: reads > 2 ? "cancelled" : "pending" }],
    });
  }) as unknown as typeof fetch;
  renderPage();
  await user.click(
    await screen.findByRole("button", { name: "Cancel allowance" }),
  );
  const dialog = screen.getByRole("alertdialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Cancel allowance" }),
  );
  await user.click(
    await within(dialog).findByRole("button", { name: "Refresh allowance" }),
  );
  expect(dialog).toBeInTheDocument();
  expect(within(dialog).getByRole("alert")).toHaveTextContent(
    "Couldn't load allowance",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Refresh allowance" }),
  );
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Add" })).toHaveFocus(),
  );
  expect(screen.getByText("Cancelled (1)")).toBeInTheDocument();
});

it("marks a pending allowance paid once and uses the canonical payment date", async () => {
  const user = userEvent.setup();
  let finish!: (response: Response) => void;
  let writes = 0;
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/me") return response({ user: { role: "parent" } });
    if (init?.method === "PATCH") {
      writes += 1;
      expect(JSON.parse(init.body as string)).toEqual({ status: "paid" });
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }
    return response({ items: [{ ...item, reason: null }] });
  }) as unknown as typeof fetch;
  renderPage();
  await user.dblClick(await screen.findByRole("button", { name: "Mark paid" }));
  expect(writes).toBe(1);
  expect(
    screen.getByRole("button", { name: "Cancel allowance" }),
  ).toBeDisabled();
  finish(
    response({
      allowance: {
        ...item,
        status: "paid",
        paid_at: "2030-10-15T12:00:00.000Z",
      },
    }),
  );
  await screen.findByText("Recently paid");
  await waitFor(() =>
    expect(screen.getByRole("link", { name: "Add" })).toHaveFocus(),
  );
  expect(
    screen.getByText(
      `Paid ${new Date("2030-10-15T12:00:00.000Z").toLocaleDateString("en")}`,
    ),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark paid" })).toBeNull();
  expect(writes).toBe(1);
});
