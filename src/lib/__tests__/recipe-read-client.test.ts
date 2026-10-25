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
