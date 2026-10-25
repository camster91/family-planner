import { readRecipePickerPage } from "@/lib/recipe-picker-client";
const row = { id: "r", title: "Soup", prep_time: null, cook_time: 20, servings: 4 };
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;

describe("recipe picker page read", () => {
  afterEach(() => jest.useRealTimers());
  it("requests only the chosen full-library search page", async () => {
    const transport = jest.fn(async () => response({ recipes: [row], nextOffset: null }));
    await expect(readRecipePickerPage("rice & beans", 24, new AbortController().signal, transport))
      .resolves.toEqual({ recipes: [row], nextOffset: null });
    expect(transport).toHaveBeenCalledWith("/api/recipes?limit=24&offset=24&q=rice+%26+beans",
      { cache: "no-store", signal: expect.any(AbortSignal) });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    {}, { recipes: [row], nextOffset: 24 },
    { recipes: [row, row], nextOffset: null },
    { recipes: [{ ...row, title: {} }], nextOffset: null },
    { recipes: Array.from({ length: 25 }, (_, i) => ({ ...row, id: String(i) })), nextOffset: null },
  ])("refuses malformed, duplicate, oversized or inconsistent pages", async (body) => {
    await expect(readRecipePickerPage("", 0, new AbortController().signal,
      jest.fn(async () => response(body)))).rejects.toThrow();
  });
  it("accepts the exact next page without automatically fetching it", async () => {
    const body = { recipes: Array.from({ length: 24 }, (_, i) => ({ ...row, id: String(i) })), nextOffset: 48 };
    const transport = jest.fn(async () => response(body));
    await expect(readRecipePickerPage("", 24, new AbortController().signal, transport)).resolves.toEqual(body);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("settles stalled body reads even when the bridge ignores abort", async () => {
    jest.useFakeTimers();
    const transport = jest.fn(async () => ({ ok: true, json: () => new Promise(() => undefined) }) as Response);
    const pending = readRecipePickerPage("", 0, new AbortController().signal, transport);
    const rejection = expect(pending).rejects.toThrow("Recipe page unavailable");
    await jest.advanceTimersByTimeAsync(15_000);
    await rejection;
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("cancels replaced reads without waiting for a bridge response", async () => {
    const controller = new AbortController();
    const pending = readRecipePickerPage("", 0, controller.signal,
      jest.fn(async () => new Promise<Response>(() => undefined)));
    const rejection = expect(pending).rejects.toThrow("Recipe page unavailable");
    controller.abort();
    await rejection;
  });
});
