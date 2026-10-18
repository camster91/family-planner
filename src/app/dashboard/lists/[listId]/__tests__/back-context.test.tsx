/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/i18n";

const mockSession = jest.fn();
const mockPrisma = {
  user: { findUnique: jest.fn() },
  list: { findFirst: jest.fn() },
  listItem: { findMany: jest.fn() },
};
jest.mock("@/lib/supabase/server", () => ({
  getServerUser: () => mockSession(),
}));
jest.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));
jest.mock("../ListDetailClient", () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock("../PersonGroceryAdd", () => ({ PersonGroceryAdd: () => null }));
import ListDetailPage from "../page";

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockSession.mockResolvedValue({ id: "parent-a", role: "parent" });
  mockPrisma.user.findUnique.mockResolvedValue({
    id: "parent-a",
    family_id: "family-a",
  });
  mockPrisma.list.findFirst.mockResolvedValue({
    id: "list-a",
    name: "School forms",
    type: "todo",
    updated_at: new Date(),
    creator: { name: "Avery" },
  });
  mockPrisma.listItem.findMany.mockResolvedValue([]);
});

async function show(type?: string | string[], locale: "en" | "es" = "en") {
  const page = await ListDetailPage({
    params: Promise.resolve({ listId: "list-a" }),
    searchParams: Promise.resolve({ type }),
  });
  render(<I18nProvider locale={locale}>{page}</I18nProvider>);
}

it("returns to the filtered overview while keeping the read household scoped", async () => {
  await show("todo");
  expect(
    screen.getByRole("link", { name: "Lists" }),
  ).toHaveAttribute("href", "/dashboard/lists?type=todo");
  expect(mockPrisma.list.findFirst.mock.calls[0][0].where).toEqual({
    id: "list-a",
    family_id: "family-a",
  });
  expect(
    screen.getByRole("button", { name: "Delete list “School forms”" }),
  ).toBeVisible();
});

it.each([undefined, "unknown", "https://example.test/leave"])(
  "falls back to the canonical overview for %s",
  async (type) => {
    await show(type);
    expect(
      screen.getByRole("link", { name: "Lists" }),
    ).toHaveAttribute("href", "/dashboard/lists");
  },
);

it("keeps context for missing lists without adding delete authority", async () => {
  mockPrisma.list.findFirst.mockResolvedValue(null);
  await show(["grocery", "todo"]);
  expect(screen.getByRole("heading", { name: "List not found" })).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Lists" }),
  ).toHaveAttribute("href", "/dashboard/lists?type=grocery");
  expect(
    screen.queryByRole("button", { name: /Delete list/ }),
  ).not.toBeInTheDocument();
});

it("localizes the back link and retains child delete restrictions", async () => {
  mockSession.mockResolvedValue({ id: "child-a", role: "child" });
  await show("todo", "es");
  expect(
    screen.getByRole("link", { name: "Listas" }),
  ).toHaveAttribute("href", "/dashboard/lists?type=todo");
  expect(
    screen.queryByRole("button", { name: /Eliminar lista/ }),
  ).not.toBeInTheDocument();
});
