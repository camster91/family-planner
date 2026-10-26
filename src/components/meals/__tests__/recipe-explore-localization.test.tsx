/** @jest-environment jsdom */
jest.mock("@/lib/review-document-browser", () =>
  require("@/__tests__/helpers/legacy-recipe-review").legacyRecipeReviewMock(),
);
import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { I18nProvider } from "@/i18n";
import Explore from "@/app/dashboard/meals/explore/page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
jest.mock("@/components/ui/feature-gate", () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const response = (body: unknown, ok = true, role = "parent") => ({
  headers: new Headers({ "X-Herewoven-Recipe-Owner": JSON.stringify({ protocol: "herewoven.recipe-owner.v1", actorId: role === "child" ? "child-a" : "parent-a", familyId: "family-a", role, generation: 0 }) }),
  ok,
  status: ok ? 200 : 503,
  json: async () => body,
});

function setupFetch(
  overrides: {
    library?: () => Promise<unknown>;
    discover?: () => Promise<unknown>;
    preview?: () => Promise<unknown>;
  } = {},
) {
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href === "/api/auth/me") return response({ user: { role: "parent" } });
    if (href === "/api/recipes/collections")
      return response({ collections: [] });
    if (href.startsWith("/api/recipes?"))
      return (
        overrides.library?.() ?? response({ recipes: [], nextOffset: null })
      );
    if (href === "/api/recipes/discover")
      return overrides.discover?.() ?? response({ results: [] });
    if (href === "/api/recipes/preview")
      return overrides.preview?.() ?? response({ recipe: null }, false);
    throw new Error(
      `unexpected fixture request: ${href} ${init?.method ?? "GET"}`,
    );
  }) as jest.Mock;
}

function renderExplore(locale: "en" | "es" = "en") {
  return render(
    <I18nProvider locale={locale}>
      <Explore />
    </I18nProvider>,
  );
}

it("localizes semantic controls and keeps publisher names as source content", async () => {
  setupFetch();
  renderExplore("es");

  expect(
    await screen.findByRole("heading", { name: "Explorar recetas", level: 1 }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Buscar en línea" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("¿Qué te gustaría cocinar?")).toHaveAttribute(
    "placeholder",
    "Pollo, pasta, cenas rápidas…",
  );
  expect(screen.getByRole("button", { name: "Buscar recetas" })).toHaveClass(
    "min-h-[44px]",
  );
  expect(
    screen.getByRole("link", { name: "Buscar en BBC Good Food ↗" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Tu caja de recetas" }),
  ).toBeInTheDocument();
});

it("maps library failures to safe localized retry copy and keeps retry scoped", async () => {
  setupFetch({
    library: async () => response({ error: "private database detail" }, false),
  });
  renderExplore("es");

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(
    "No se pudieron cargar las recetas guardadas. Inténtalo de nuevo.",
  );
  expect(alert).not.toHaveTextContent("private database detail");
  expect(screen.getByRole("button", { name: "Intentar de nuevo" })).toHaveClass(
    "min-h-[44px]",
  );
});

it("maps search and preview failures to semantic copy without exposing API errors", async () => {
  const user = userEvent.setup();
  setupFetch({
    discover: async () => response({ error: "provider token detail" }, false),
    preview: async () => {
      throw new TypeError("network secret detail");
    },
  });
  renderExplore("es");

  await screen.findByLabelText("Enlace de receta");
  await user.type(screen.getByLabelText("¿Qué te gustaría cocinar?"), "sopa");
  await user.click(screen.getByRole("button", { name: "Buscar recetas" }));
  const searchAlert = await screen.findByRole("alert");
  expect(searchAlert).toHaveTextContent(
    "No se pudo buscar en esa fuente. Inténtalo de nuevo.",
  );
  expect(searchAlert).not.toHaveTextContent("provider token detail");

  await user.type(
    screen.getByLabelText("Enlace de receta"),
    "https://example.org/soup",
  );
  await user.click(screen.getByRole("button", { name: "Leer receta" }));
  const previewAlert = await screen.findByText(
    "No se pudo conectar con esa receta. Revisa tu conexión e inténtalo de nuevo.",
  );
  expect(previewAlert).toBeInTheDocument();
  expect(previewAlert).not.toHaveTextContent("network secret detail");
  expect(
    screen.getByRole("link", { name: "Abrir original ↗" }),
  ).toHaveAttribute("href", "https://example.org/soup");
});
