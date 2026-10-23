import {
  canonicalRecipeSource,
  collectionMutation,
  recipeCurationMutation,
} from "@/lib/recipe-curation-contract";
test("source identity drops tracking and fragments but preserves recipe-specific parameters and path case", () => {
  expect(
    canonicalRecipeSource(
      "https://recipes.example.test/Soup?variant=2&utm_source=test#method",
    ),
  ).toBe("https://recipes.example.test/Soup?variant=2");
  expect(
    canonicalRecipeSource("https://recipes.example.test/Soup?variant=1"),
  ).not.toBe(
    canonicalRecipeSource("https://recipes.example.test/soup?variant=2"),
  );
  expect(
    canonicalRecipeSource("https://user:password@recipes.example.test/soup"),
  ).toBeNull();
});
test("collection mutations normalize names and keep explicit revision and selection bounds", () => {
  expect(
    collectionMutation.parse({ action: "create", name: "  Quick   meals  " }),
  ).toEqual({ action: "create", name: "Quick meals" });
  expect(
    collectionMutation.safeParse({ action: "delete", id: "fx_group" }).success,
  ).toBe(false);
  expect(
    recipeCurationMutation.safeParse({
      revision: 0,
      favorite: true,
      collectionIds: ["fx_group", "fx_group"],
    }).success,
  ).toBe(false);
  expect(
    recipeCurationMutation.safeParse({
      revision: 0,
      favorite: true,
      collectionIds: Array.from({ length: 9 }, (_, n) => `fx_${n}`),
    }).success,
  ).toBe(false);
});
