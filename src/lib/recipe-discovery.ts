/** Public recipe metadata only. Never execute publisher HTML. */
import type {
  OnlineRecipe,
  RecipeImportIssue,
} from "@/lib/recipe-preview-contract";
export type { OnlineRecipe } from "@/lib/recipe-preview-contract";
export function publicRecipeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      raw.length > 1500
    )
      return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}
function text(value: unknown, max = 20000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(?:amp|quot|apos|lt|gt|nbsp);/g,
      (entity) =>
        ({
          "&amp;": "&",
          "&quot;": '"',
          "&apos;": "'",
          "&lt;": "<",
          "&gt;": ">",
          "&nbsp;": " ",
        })[entity] ?? entity,
    )
    .trim()
    .slice(0, max);
}
function minutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const n = Number(match[1] || 0) * 60 + Number(match[2] || 0);
  return n <= 1440 ? n : null;
}
export function extractOnlineRecipe(
  html: string,
  source: string,
): OnlineRecipe | null {
  const url = publicRecipeUrl(source);
  if (!url || html.length > 2 * 1024 * 1024) return null;
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  let inspected = 0;
  function find(value: unknown, depth = 0): Record<string, unknown> | null {
    if (++inspected > 2000 || depth > 12 || !value || typeof value !== "object")
      return null;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const hit = find(entry, depth + 1);
        if (hit) return hit;
      }
      return null;
    }
    const object = value as Record<string, unknown>;
    const types = Array.isArray(object["@type"])
      ? object["@type"]
      : [object["@type"]];
    if (types.includes("Recipe") && text(object.name, 200)) return object;
    for (const child of Object.values(object)) {
      const hit = find(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  let blocks = 0;
  for (const script of scripts) {
    if (++blocks > 64) break;
    try {
      const recipe = find(JSON.parse(script[1]));
      if (!recipe) continue;
      const issues = new Set<RecipeImportIssue>();
      function boundedText(
        value: unknown,
        max: number,
        issue: RecipeImportIssue,
      ) {
        // Keep cleaning distinct from clipping so shortening is always visible.
        const clean = text(value, 2 * 1024 * 1024);
        if (clean.length > max) issues.add(issue);
        return clean.slice(0, max);
      }
      const ingredientLines: string[] = [];
      if (Array.isArray(recipe.recipeIngredient)) {
        if (recipe.recipeIngredient.length > 100)
          issues.add("ingredients-shortened");
        for (const line of recipe.recipeIngredient.slice(0, 100)) {
          const clean = boundedText(line, 500, "ingredients-shortened");
          if (clean) ingredientLines.push(clean);
          else issues.add("ingredients-shortened");
        }
      }
      const directions: string[] = [];
      let stepNodes = 0,
        directionChars = 0;
      function steps(value: unknown, depth = 0): void {
        if (value === undefined || value === null) return;
        if (
          ++stepNodes > 2000 ||
          depth > 8 ||
          directions.length >= 100 ||
          directionChars >= 14000
        ) {
          issues.add("directions-shortened");
          return;
        }
        if (typeof value === "string") {
          const clean = boundedText(value, 14000, "directions-shortened");
          if (clean) {
            directions.push(clean);
            directionChars += clean.length + 2;
          }
        } else if (Array.isArray(value)) {
          for (let index = 0; index < value.length; index++) {
            steps(value[index], depth + 1);
            if (
              stepNodes > 2000 ||
              directions.length >= 100 ||
              directionChars >= 14000
            ) {
              if (index < value.length - 1) issues.add("directions-shortened");
              break;
            }
          }
        } else if (typeof value === "object") {
          const object = value as Record<string, unknown>;
          steps(object.itemListElement ?? object.text, depth + 1);
        }
      }
      steps(recipe.recipeInstructions);
      const joined = directions.join("\n\n");
      if (joined.length > 14000) issues.add("directions-shortened");
      const instructions = joined.slice(0, 14000);
      const yieldText = Array.isArray(recipe.recipeYield)
        ? recipe.recipeYield[0]
        : recipe.recipeYield;
      const yieldMatch =
        typeof yieldText === "number"
          ? [String(yieldText), String(yieldText)]
          : typeof yieldText === "string"
            ? /^(?:Serves\s+)?(\d+)(?:\s+(?:servings|people))?$/i.exec(
                yieldText.trim(),
              )
            : null;
      const count = yieldMatch ? Number(yieldMatch[1]) : NaN;
      const servings =
        Number.isInteger(count) && count >= 1 && count <= 100 ? count : null;
      const prep_time = minutes(recipe.prepTime),
        cook_time = minutes(recipe.cookTime);
      if (servings === null) issues.add("servings-unknown");
      if (prep_time === null) issues.add("prep-time-unknown");
      if (cook_time === null) issues.add("cook-time-unknown");
      if (!ingredientLines.length) issues.add("ingredients-missing");
      if (!instructions) issues.add("directions-missing");
      return {
        servings,
        title: boundedText(recipe.name, 200, "title-shortened"),
        description: boundedText(
          recipe.description,
          400,
          "description-shortened",
        ),
        instructions,
        ingredientLines,
        source: url,
        prep_time,
        cook_time,
        reviewIssues: [...issues],
      };
    } catch {
      /* Another bounded JSON-LD block may contain the recipe. */
    }
  }
  return null;
}
export const recipeSources = [
  { name: "BBC Good Food", search: "https://www.bbcgoodfood.com/search?q=" },
  { name: "Allrecipes", search: "https://www.allrecipes.com/search?q=" },
  { name: "Serious Eats", search: "https://www.seriouseats.com/search?q=" },
] as const;

/** Search result titles/links only; publisher content stays at its source. */
export function extractRecipeLinks(
  html: string,
  searchUrl: string,
): Array<{ title: string; url: string }> {
  if (html.length > 2 * 1024 * 1024) return [];
  const host = new URL(searchUrl).hostname.replace(/^www\./, "");
  const results = new Map<string, { title: string; url: string }>();
  for (const anchor of html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
  )) {
    try {
      const link = new URL(anchor[1].replace(/&amp;/g, "&"), searchUrl);
      if (
        link.hostname.replace(/^www\./, "") !== host ||
        link.protocol !== "https:" ||
        link.username ||
        link.password
      )
        continue;
      if (!(
        /\/recipes?\/[^/]+/.test(link.pathname) ||
        /-recipe(?:-\d+)?$/.test(link.pathname)
      ))
        continue;
      const title = text(anchor[2], 200).replace(/\s+/g, " ").trim();
      if (!title || title.length < 3) continue;
      link.search = "";
      link.hash = "";
      const url = link.toString();
      if (!results.has(url)) results.set(url, { title, url });
      if (results.size >= 24) break;
    } catch {
      /* Skip invalid publisher links. */
    }
  }
  return [...results.values()];
}
