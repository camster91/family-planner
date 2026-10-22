/** @jest-environment jsdom */
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/lib/review-document-browser", () =>
  require("@/__tests__/helpers/legacy-recipe-review").legacyRecipeReviewMock(),
);
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@/i18n";
import { RecipeEditor } from "../RecipeEditor";
import type { RecipeDetailData } from "../RecipeDetail";

const RECIPE: RecipeDetailData = {
  id: "r-es",
  title: "Sopa de mamá",
  description: "Descripción original",
  instructions: "Mezcla y cocina.",
  prep_time: 5,
  cook_time: 20,
  servings: 4,
  ingredients: [
    {
      id: "line-es",
      amount: 2,
      unit: "tbsp",
      note: "finely chopped",
      ingredient: { id: "ingredient-es", name: "Red Onion", unit: "pcs" },
    },
  ],
};

function withSpanish(children: React.ReactNode) {
  return <I18nProvider locale="es">{children}</I18nProvider>;
}

it("localizes the editor surface while preserving recipe content and units", () => {
  render(
    withSpanish(
      <RecipeEditor
        initialRecipe={RECIPE}
        onSaved={jest.fn()}
        onCancel={jest.fn()}
      />,
    ),
  );

  expect(screen.getByText("Detalles de la receta")).toBeTruthy();
  expect(
    (screen.getByLabelText("Nombre de la receta") as HTMLInputElement).value,
  ).toBe(RECIPE.title);
  expect(
    (screen.getByLabelText("Porciones base") as HTMLInputElement).value,
  ).toBe("4");
  expect(
    (screen.getByLabelText("Descripción") as HTMLTextAreaElement).value,
  ).toBe(RECIPE.description);
  expect(
    (screen.getByLabelText("Preparación") as HTMLTextAreaElement).value,
  ).toBe(RECIPE.instructions);
  expect(
    (screen.getByLabelText("Preparación (min)") as HTMLInputElement).value,
  ).toBe("5");
  expect(
    (screen.getByLabelText("Cocción (min)") as HTMLInputElement).value,
  ).toBe("20");
  expect((screen.getByLabelText("Cantidad") as HTMLInputElement).value).toBe(
    "2",
  );
  expect((screen.getByLabelText("Unidad") as HTMLInputElement).value).toBe(
    "tbsp",
  );
  expect((screen.getByLabelText("Ingrediente") as HTMLInputElement).value).toBe(
    "Red Onion",
  );
  expect(
    (screen.getByLabelText("Nota del ingrediente") as HTMLInputElement).value,
  ).toBe("finely chopped");
  expect(
    screen.getByRole("button", { name: "Añadir ingrediente" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancelar" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Guardar receta" })).toBeTruthy();
});

it("localizes validation and keeps the draft after a rejected save", async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn(
    async () =>
      ({
        ok: false,
        status: 403,
        json: async () => ({ error: "Ask a parent or teen to add a recipe." }),
      }) as Response,
  ) as typeof fetch;

  render(
    withSpanish(<RecipeEditor onCreated={jest.fn()} onCancel={jest.fn()} />),
  );
  await user.click(
    await screen.findByRole("button", { name: "Guardar receta" }),
  );
  expect(screen.getByRole("alert").textContent).toBe(
    "Escribe un nombre para la receta.",
  );
  await user.type(await screen.findByLabelText("Nombre de la receta"), "Sopa");
  await user.click(
    await screen.findByRole("button", { name: "Guardar receta" }),
  );

  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      "No se aceptó la receta. Revisa los datos y tus permisos.",
    ),
  );
  expect(screen.getByRole("alert").textContent).not.toContain(
    "Ask a parent or teen",
  );
  expect(
    (screen.getByLabelText("Nombre de la receta") as HTMLInputElement).value,
  ).toBe("Sopa");
  expect(
    (
      screen.getByRole("button", {
        name: "Guardar receta",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(false);
});

it("localizes the pending save state", async () => {
  let resolve!: (response: Response) => void;
  global.fetch = jest.fn(
    () => new Promise<Response>((done) => (resolve = done)),
  ) as typeof fetch;
  const user = userEvent.setup();

  render(
    withSpanish(<RecipeEditor onCreated={jest.fn()} onCancel={jest.fn()} />),
  );
  await user.type(await screen.findByLabelText("Nombre de la receta"), "Sopa");
  await user.click(
    await screen.findByRole("button", { name: "Guardar receta" }),
  );
  expect(screen.getByRole("button", { name: "Guardando…" })).toBeTruthy();
  expect(
    (screen.getByTestId("recipe-quick-create") as HTMLFieldSetElement).disabled,
  ).toBe(true);

  resolve({
    ok: true,
    status: 201,
    json: async () => ({
      recipe: {
        ...RECIPE,
        id: "created-es",
        title: "Sopa",
      },
    }),
  } as Response);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Guardar receta",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
});
