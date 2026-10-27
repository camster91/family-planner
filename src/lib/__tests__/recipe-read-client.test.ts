import { readRecipeJson } from "@/lib/recipe-read-client";

describe("bounded canonical recipe reads", () => {
  afterEach(() => jest.useRealTimers());
  it("does not fetch or write for already dismissed work", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = jest.fn();
    await expect(readRecipeJson("/api/recipes/r", controller.signal, { fetchImpl: transport }))
      .rejects.toThrow("Recipe read unavailable");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["headers", "body"])("settles ignored-abort %s stalls at the caller's deadline", async (stage) => {
    jest.useFakeTimers();
    const transport = jest.fn(async () => stage === "headers"
      ? new Promise<Response>(() => undefined)
      : { ok: true, json: () => new Promise(() => undefined) } as Response);
    const pending = readRecipeJson("/api/recipes/r", new AbortController().signal,
      { fetchImpl: transport, timeoutMs: 10000 });
    const rejection = expect(pending).rejects.toThrow("Recipe read unavailable");
    await jest.advanceTimersByTimeAsync(10000);
    await rejection;
    expect(transport).toHaveBeenCalledTimes(1);
    expect((transport.mock.calls as unknown as Array<[string, RequestInit]>)[0][1].signal?.aborted).toBe(true);
  });
  it("refuses declared oversized responses without parsing them", async () => {
    const json = jest.fn();
    const transport = jest.fn(async () => ({ ok: true,
      headers: new Headers({ "content-length": String(1024 * 1024 + 1) }), json,
    }) as unknown as Response);
    await expect(readRecipeJson("/api/recipes/r", new AbortController().signal, { fetchImpl: transport }))
      .rejects.toThrow("Recipe read unavailable");
    expect(json).not.toHaveBeenCalled();
  });
  it("refuses oversized JSON-only bridge data after parsing", async () => {
    const transport = jest.fn(async () => ({ ok: true, json: async () => ({ text: "x".repeat(1024 * 1024) }) }) as Response);
    await expect(readRecipeJson("/api/recipes/r", new AbortController().signal, { fetchImpl: transport }))
      .rejects.toThrow("Recipe read unavailable");
  });
});

// Library boundary cases authored UNRUN; shared transport deadline/body cases remain above.
const libraryOwner = { protocol: "herewoven.recipe-owner.v1", actorId: "parent-a", familyId: "family-a", role: "parent", generation: 0 } as const;
const libraryHeaders = () => new Headers({ "X-Herewoven-Recipe-Owner": JSON.stringify(libraryOwner) });
describe("recipe library pages", () => {
  it("projects one searched page and strips unrelated fields without fetching continuation", async () => {
    const { readRecipeLibraryPage } = await import("../recipe-library-client");
    const transport = jest.fn(async () => ({ ok: true, headers: libraryHeaders(), json: async () => ({ recipes: [{
      id: "recipe-a", title: "Soup", description: null, favorite: true, privateExtra: "discard",
    }], nextOffset: null }) }) as Response);
    await expect(readRecipeLibraryPage("q=rice+%26+beans&favorite=1", 100, new AbortController().signal, transport))
      .resolves.toEqual({ recipes: [{ id: "recipe-a", title: "Soup", description: null, favorite: true }], nextOffset: null, owner: libraryOwner });
    expect(transport).toHaveBeenCalledWith("/api/recipes?limit=100&offset=100&q=rice+%26+beans&favorite=1", {
      cache: "no-store", signal: expect.any(AbortSignal),
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    { recipes: [{ id: "bad/path", title: "Soup", description: null }], nextOffset: null },
    { recipes: [{ id: "r", title: {}, description: null }], nextOffset: null },
    { recipes: [{ id: "r", title: "Soup", description: null }], nextOffset: 100 },
    { recipes: [{ id: "r", title: "Soup", description: null }, { id: "r", title: "Again", description: null }], nextOffset: null },
    { recipes: [], nextOffset: -1 },
  ])("refuses malformed or inconsistent page data", async body => {
    const { readRecipeLibraryPage } = await import("../recipe-library-client");
    await expect(readRecipeLibraryPage("", 0, new AbortController().signal,
      jest.fn(async () => ({ ok: true, headers: libraryHeaders(), json: async () => body }) as Response))).rejects.toThrow("Recipe library unavailable");
  });
  it("refuses duplicate filters before a request", async () => {
    const { readRecipeLibraryPage } = await import("../recipe-library-client");
    const transport = jest.fn();
    await expect(readRecipeLibraryPage("q=one&q=two", 0, new AbortController().signal, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

it("rejects a changed library owner before decoding private recipe data", async () => {
  const { readRecipeLibraryPage, RecipeLibraryOwnerChanged } = await import("../recipe-library-client");
  const json = jest.fn();
  const transport = jest.fn(async (_path: RequestInfo | URL, _init?: RequestInit) => ({ ok: true, status: 200, headers: new Headers({
    "X-Herewoven-Recipe-Owner": JSON.stringify({ ...libraryOwner, familyId: "family-b" }),
  }), json }) as unknown as Response);
  await expect(readRecipeLibraryPage("", 100, new AbortController().signal, transport, libraryOwner))
    .rejects.toBeInstanceOf(RecipeLibraryOwnerChanged);
  expect(json).not.toHaveBeenCalled();
  expect(transport.mock.calls[0][1]?.headers).toEqual({ "X-Herewoven-Recipe-Owner": JSON.stringify(libraryOwner) });
});
