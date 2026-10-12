/** @jest-environment jsdom */

import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/components/ui/toast";
import AllowancePage from "../page";

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

it("does not expose the Add link while the current role is a teen", async () => {
  global.fetch = jest.fn(async (url: string) => {
    if (url === "/api/auth/me") return response({ user: { role: "teen" } });
    if (url === "/api/allowance") return response({ items: [] });
    return response({});
  }) as unknown as typeof fetch;

  renderPage();
  await screen.findByText("No allowance yet");
  expect(screen.queryByRole("link", { name: "Add" })).not.toBeInTheDocument();
});
