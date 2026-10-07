import { fetchPlanningRange } from "../fetch";
it("rejects repeated cursors instead of silently accepting incomplete data", async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(
      response({ events: [], hasMore: true, nextCursor: "same" }),
    )
    .mockResolvedValueOnce(
      response({ events: [], hasMore: true, nextCursor: "same" }),
    )
    .mockRejectedValue(new Error("test safety stop"));
  await expect(
    fetchPlanningRange("s", "e", new AbortController().signal, request),
  ).rejects.toThrow("paging");
  expect(request).toHaveBeenCalledTimes(2);
});
it("stops at an explicit page budget, returning a truncation flag", async () => {
  let i = 0;
  const request = jest.fn(async () => {
    if (i >= 2) throw new Error("test safety stop");
    return response({
      events: [{ id: String(++i) }],
      hasMore: true,
      nextCursor: String(i),
    });
  });
  const result = await fetchPlanningRange(
    "s",
    "e",
    new AbortController().signal,
    request,
    2,
  );
  expect(result.truncated).toBe(true);
  expect(result.events).toHaveLength(2);
});
it("rejects failed responses, malformed paging and aborted requests", async () => {
  await expect(
    fetchPlanningRange(
      "s",
      "e",
      new AbortController().signal,
      jest.fn(async () => ({ ok: false }) as Response),
    ),
  ).rejects.toThrow("could not load");
  await expect(
    fetchPlanningRange(
      "s",
      "e",
      new AbortController().signal,
      jest.fn(async () =>
        response({ events: [], hasMore: true, nextCursor: null }),
      ),
    ),
  ).rejects.toThrow("paging");
  const controller = new AbortController();
  controller.abort();
  await expect(
    fetchPlanningRange(
      "s",
      "e",
      controller.signal,
      jest.fn(async () => response({ events: [], hasMore: false })),
    ),
  ).rejects.toThrow();
});
const response = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;
it("reads every cursor page with the same bounded range and signal", async () => {
  const request = jest
    .fn()
    .mockResolvedValueOnce(
      response({ events: [{ id: "a" }], hasMore: true, nextCursor: "next" }),
    )
    .mockResolvedValueOnce(
      response({ events: [{ id: "b" }], hasMore: false, nextCursor: null }),
    );
  const signal = new AbortController().signal;
  const result = await fetchPlanningRange(
    "2026-01-01T00:00:00Z",
    "2026-01-08T00:00:00Z",
    signal,
    request,
  );
  expect(result.events.map((e) => e.id)).toEqual(["a", "b"]);
  expect(result.truncated).toBe(false);
  expect(request.mock.calls[1][0]).toContain("cursor=next");
  expect(request.mock.calls[1][1].signal).toBe(signal);
});
