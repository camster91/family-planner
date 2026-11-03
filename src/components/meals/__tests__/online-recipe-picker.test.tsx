/** @jest-environment jsdom */
import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnlineRecipePicker } from "../OnlineRecipePicker";
import { requestRecipeCurationJson } from "@/lib/recipe-curation-client";
import {
  RECIPE_OWNER_HEADER,
  RECIPE_OWNER_PROTOCOL,
} from "@/lib/recipe-owner-contract";
jest.mock("@/lib/recipe-curation-client", () => ({
  requestRecipeCurationJson: jest.fn(),
}));
jest.mock("../RecipeEditor", () => ({
  RecipeEditor: ({ onCreated }: { onCreated: (r: unknown) => void }) => (
    <button
      type="button"
      onClick={() =>
        onCreated({
          id: "saved",
          title: "Soup",
          prep_time: 10,
          cook_time: 20,
          servings: 4,
        })
      }
    >
      Save reviewed recipe
    </button>
  ),
}));
const request = jest.mocked(requestRecipeCurationJson);
const owner = {
  protocol: RECIPE_OWNER_PROTOCOL,
  actorId: "u1",
  familyId: "f1",
  role: "parent",
  generation: 1,
};
function reply(body: unknown, familyId = "f1") {
  return {
    kind: "reply" as const,
    body,
    response: {
      ok: true,
      status: 200,
      headers: new Headers({
        [RECIPE_OWNER_HEADER]: JSON.stringify({ ...owner, familyId }),
      }),
    },
  } as Awaited<ReturnType<typeof requestRecipeCurationJson>>;
}
const results = {
  results: [
    {
      title: "Soup",
      url: "https://www.bbcgoodfood.com/recipes/soup",
      source: "BBC Good Food",
    },
  ],
};
const recipe = {
  title: "Soup",
  source: results.results[0].url,
  description: "Vegetable soup",
  ingredientLines: ["2 carrots"],
  instructions: "Cook vegetables.",
  prep_time: 10,
  cook_time: 20,
  servings: 4,
};
beforeEach(() => request.mockReset());
test("search → publisher preview → existing reviewed save returns a real recipe without submitting the meal", async () => {
  request
    .mockResolvedValueOnce(reply(results))
    .mockResolvedValueOnce(reply({ recipe }));
  const selected = jest.fn(),
    submit = jest.fn();
  const user = userEvent.setup();
  render(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <OnlineRecipePicker onCreated={selected} />
    </form>,
  );
  await user.type(screen.getByRole("searchbox"), "soup{Enter}");
  await user.click(
    within((await screen.findByText("Soup")).closest("li")!).getByRole(
      "button",
      { name: "Preview recipe" },
    ),
  );
  await screen.findByText("2 carrots");
  expect(request.mock.calls[0][3]).toEqual({ timeoutMs: 45000 });
  expect(request.mock.calls[1][3]).toEqual({ timeoutMs: 15000 });
  expect(request.mock.calls[1][1].headers).toEqual(
    expect.objectContaining({ [RECIPE_OWNER_HEADER]: JSON.stringify(owner) }),
  );
  await user.click(
    screen.getByRole("button", { name: "Review and save for this meal" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Save reviewed recipe" }),
  );
  expect(selected).toHaveBeenCalledWith(
    expect.objectContaining({ id: "saved" }),
  );
  expect(submit).not.toHaveBeenCalled();
});
test("changed owner clears results and refuses import", async () => {
  request
    .mockResolvedValueOnce(reply(results))
    .mockResolvedValueOnce(reply({ recipe }, "f2"));
  const user = userEvent.setup();
  render(<OnlineRecipePicker onCreated={jest.fn()} />);
  await user.type(screen.getByRole("searchbox"), "soup{Enter}");
  await user.click(
    within((await screen.findByText("Soup")).closest("li")!).getByRole(
      "button",
      { name: "Preview recipe" },
    ),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "session or household changed",
  );
  expect(screen.queryByText("2 carrots")).not.toBeInTheDocument();
});
test("failed discovery retains query, exposes Google as an external search and allows retry", async () => {
  request
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(reply(results));
  const user = userEvent.setup();
  render(<OnlineRecipePicker onCreated={jest.fn()} />);
  await user.type(screen.getByRole("searchbox"), "soup{Enter}");
  await screen.findByRole("alert");
  expect(screen.getByRole("searchbox")).toHaveValue("soup");
  expect(screen.getByRole("link", { name: /Search Google/ })).toHaveAttribute(
    "href",
    "https://www.google.com/search?q=soup%20recipe",
  );
  await user.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Soup");
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});

test("a known source uses the household recipe directly without another editor save", async () => {
  const saved = {
    id: "canonical-soup",
    title: "Our soup",
    prep_time: 5,
    cook_time: 20,
    servings: 6,
    source_url: recipe.source,
  };
  request
    .mockResolvedValueOnce(reply(results))
    .mockResolvedValueOnce(reply({ existingRecipe: saved }));
  const user = userEvent.setup(),
    selected = jest.fn();
  render(<OnlineRecipePicker onCreated={selected} planLabel="Plan meal" />);
  await user.type(screen.getByRole("searchbox"), "soup{Enter}");
  await user.click(
    within((await screen.findByText("Soup")).closest("li")!).getByRole(
      "button",
      { name: "Preview recipe" },
    ),
  );
  await screen.findByText("Our soup");
  expect(JSON.parse(request.mock.calls[1][1].body as string)).toEqual({
    url: recipe.source,
    preferSaved: true,
  });
  expect(
    screen.queryByRole("button", { name: "Save reviewed recipe" }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Plan meal" }));
  expect(selected).toHaveBeenCalledWith(saved);
  expect(request).toHaveBeenCalledTimes(2);
});

test("grounded results preserve citations/suggestions and return from source preview", async () => {
  const grounded = {
    blocks: [
      {
        type: "text",
        text: "Try soup.",
        annotations: [
          {
            type: "url_citation",
            url: recipe.source,
            title: "Soup source",
            start_index: 0,
            end_index: 9,
          },
        ],
      },
    ],
    suggestions: [
      '<div><a href="https://www.google.com/search?q=soup" target="_blank">Search soup</a></div>',
    ],
  };
  request
    .mockResolvedValueOnce(reply({ results: [], grounded }))
    .mockResolvedValueOnce(reply({ recipe }));
  const user = userEvent.setup();
  render(<OnlineRecipePicker onCreated={jest.fn()} />);
  await user.type(screen.getByRole("searchbox"), "soup{Enter}");
  await screen.findByRole("heading", { name: "Recipes found with Google" });
  expect(
    screen.queryByText(
      "No recipes found. Try a different search or paste a link.",
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open source: Soup source" }),
  ).toHaveAttribute("href", recipe.source);
  const frame = screen.getByTitle("Google search suggestions 1");
  expect(frame).toHaveAttribute(
    "sandbox",
    "allow-popups allow-popups-to-escape-sandbox",
  );
  expect(frame.getAttribute("srcdoc")).toContain("script-src 'none'");
  expect(frame.getAttribute("srcdoc")).toContain(grounded.suggestions[0]);
  expect(screen.queryByText("Search soup")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview source" }));
  await screen.findByText("2 carrots");
  expect(JSON.parse(request.mock.calls[1][1].body as string)).toEqual({
    url: recipe.source,
    preferSaved: true,
  });
  await user.click(screen.getByRole("button", { name: "← Back to recipes" }));
  expect(screen.getByRole("searchbox")).toHaveValue("soup");
  expect(
    screen.getByRole("heading", { name: "Recipes found with Google" }),
  ).toBeInTheDocument();
});
