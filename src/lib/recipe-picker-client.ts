import { z } from "zod";

export const RECIPE_PICKER_PAGE_SIZE = 24;
const recipe = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(200),
  prep_time: z.number().finite().nonnegative().nullable(),
  cook_time: z.number().finite().nonnegative().nullable(),
  servings: z.number().finite().positive().nullable(),
});
const pageSchema = z.object({
  recipes: z.array(recipe).max(RECIPE_PICKER_PAGE_SIZE),
  nextOffset: z.number().int().nonnegative().safe().nullable(),
});

/** One canonical search page, with bounded header/body wait and explicit retry. */
export async function readRecipePickerPage(
  query: string,
  offset: number,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const failure = () => new Error("Recipe page unavailable");
  const cancelled = new Promise<never>((_resolve, reject) => {
    cancel = () => { reject(failure()); controller.abort(); };
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, 15_000);
    if (signal.aborted) cancel();
  });
  try {
    return await Promise.race([
      (async () => {
        if (controller.signal.aborted || !Number.isSafeInteger(offset) || offset < 0)
          throw failure();
        const params = new URLSearchParams({ limit: String(RECIPE_PICKER_PAGE_SIZE), offset: String(offset) });
        if (query) params.set("q", query);
        const response = await fetchImpl(`/api/recipes?${params}`, {
          cache: "no-store", signal: controller.signal,
        });
        if (controller.signal.aborted || !response.ok) throw failure();
        const page = pageSchema.parse(await response.json());
        if (new Set(page.recipes.map(row => row.id)).size !== page.recipes.length ||
          (page.nextOffset !== null && (page.recipes.length !== RECIPE_PICKER_PAGE_SIZE ||
            page.nextOffset !== offset + RECIPE_PICKER_PAGE_SIZE))) throw failure();
        return page;
      })(),
      cancelled,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal.removeEventListener("abort", cancel);
  }
}
