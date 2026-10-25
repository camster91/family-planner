import { readGroceryReview } from "@/lib/grocery-review-client";

const params = new URLSearchParams({ recipeId: "recipe-1", mealId: "meal-1" });
const reply = (body: unknown): Response => ({
  ok: true,
  json: async () => body,
}) as Response;

describe("readGroceryReview", () => {
  afterEach(() => jest.useRealTimers());

  it("reads only the exact preview URL without writing or caching", async () => {
    const body = { recipeId: "recipe-1" };
    const transport = jest.fn(async () => reply(body));
    await expect(readGroceryReview(params, new AbortController().signal, transport))
      .resolves.toBe(body);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(
      "/api/lists/items/from-recipe/review?recipeId=recipe-1&mealId=meal-1",
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
  });

  it.each(["headers", "body"])("bounds a stalled %s even when transport ignores abort", async (stage) => {
    jest.useFakeTimers();
    let release!: (value: Response) => void;
    const hanging = new Promise<Response>((resolve) => { release = resolve; });
    const transport = jest.fn(async () => stage === "headers" ? hanging : {
      ok: true,
      json: () => new Promise<unknown>(() => undefined),
    } as Response);
    const pending = readGroceryReview(params, new AbortController().signal, transport);
    const rejected = expect(pending).rejects.toThrow("Grocery review unavailable");
    await jest.advanceTimersByTimeAsync(15_000);
    await rejected;
    expect(transport.mock.calls).toHaveLength(1);
    // A late successful header cannot recover or retry the timed-out read.
    release(reply({ late: true }));
  });

  it("settles dismissal even if the request ignores cancellation", async () => {
    const controller = new AbortController();
    const transport = jest.fn(async () => new Promise<Response>(() => undefined));
    const pending = readGroceryReview(params, controller.signal, transport);
    const rejected = expect(pending).rejects.toThrow("Grocery review unavailable");
    await Promise.resolve();
    controller.abort();
    await rejected;
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("never starts a request for an already dismissed preview", async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = jest.fn(async () => reply({}));
    await expect(readGroceryReview(params, controller.signal, transport))
      .rejects.toThrow("Grocery review unavailable");
    expect(transport).not.toHaveBeenCalled();
  });

  it("refuses an unsuccessful response without reading its body", async () => {
    const json = jest.fn();
    await expect(readGroceryReview(params, new AbortController().signal,
      jest.fn(async () => ({ ok: false, json }) as unknown as Response)))
      .rejects.toThrow("Grocery review unavailable");
    expect(json).not.toHaveBeenCalled();
  });
});
