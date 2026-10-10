import { executeAssistantAction, removalTargets } from "../action-client";
const fetchMock = jest.fn();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
const ok = (body: unknown) => ({ ok: true, json: async () => body });
it("converts local event times and posts only fixed canonical fields", async () => {
  fetchMock.mockResolvedValue(ok({ event: { id: "e" } }));
  await executeAssistantAction(
    {
      kind: "event_create",
      title: "Pickup",
      start: "2026-10-10T15:00",
      end: "2026-10-10T15:30",
    },
    "key",
  );
  const [path, options] = fetchMock.mock.calls[0];
  expect(path).toBe("/api/events");
  const body = JSON.parse(options.body);
  expect(body.title).toBe("Pickup");
  expect(body.start_time).toContain("T");
  expect(body.start_time).not.toBe("2026-10-10T15:00");
});
it("rejects invalid times before network write", async () => {
  await expect(
    executeAssistantAction(
      { kind: "event_create", title: "Bad", start: "bad", end: "bad" },
      "key",
    ),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("requires an explicit target to delete; uses chosen id instead of AI search phrase", async () => {
  const action = { kind: "event_delete", title: "My event" } as const;
  await expect(executeAssistantAction(action, "key")).rejects.toThrow("Choose");
  fetchMock.mockResolvedValue(ok({ success: true }));
  await executeAssistantAction(action, "key", {
    id: "chosen",
    title: "Actual event",
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    eventId: "chosen",
  });
});
it("grocery adds reuse idempotency and never guesses among multiple lists", async () => {
  fetchMock.mockResolvedValueOnce(
    ok({
      lists: [
        { id: "a", type: "grocery" },
        { id: "b", type: "grocery" },
      ],
    }),
  );
  await expect(
    executeAssistantAction(
      { kind: "grocery_add", title: "Milk" },
      "stable-key",
    ),
  ).rejects.toThrow("Choose");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fetchMock.mockReset();
  fetchMock
    .mockResolvedValueOnce(ok({ lists: [{ id: "a", type: "grocery" }] }))
    .mockResolvedValueOnce(ok({ item: { id: "i" } }));
  await executeAssistantAction(
    { kind: "grocery_add", title: "Milk" },
    "stable-key",
  );
  expect(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]).toBe(
    "stable-key",
  );
});
it("filters read-only imported events from removal choices", async () => {
  fetchMock.mockResolvedValue(
    ok({
      events: [
        { id: "a", title: "Local", start_time: "2026-10-10T15:00Z" },
        { id: "b", title: "Remote", source_subscription_id: "feed" },
      ],
    }),
  );
  expect(
    (await removalTargets({ kind: "event_delete", title: "Test" })).map(
      (t) => t.id,
    ),
  ).toEqual(["a"]);
});
it("distinguishes same-named lists by household details", async () => {
  fetchMock.mockResolvedValue(
    ok({
      lists: [
        {
          id: "a",
          name: "Trip",
          type: "custom",
          description: "Camping",
          _count: { items: 5 },
        },
        {
          id: "b",
          name: "Trip",
          type: "custom",
          description: "Beach",
          _count: { items: 8 },
        },
      ],
    }),
  );
  const choices = await removalTargets({ kind: "list_delete", title: "Trip" });
  expect(choices.map((t) => t.context)).toEqual([
    "custom · Camping · 5 items",
    "custom · Beach · 8 items",
  ]);
});
it("refuses indistinguishable list choices before any destructive write", async () => {
  fetchMock.mockResolvedValue(
    ok({
      lists: [
        { id: "a", name: "Trip", type: "custom", _count: { items: 0 } },
        { id: "b", name: "Trip", type: "custom", _count: { items: 0 } },
      ],
    }),
  );
  await expect(
    removalTargets({ kind: "list_delete", title: "Trip" }),
  ).rejects.toThrow("Open Lists to review or rename");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].method).toBe("GET");
});
it("network loss on mutation reports uncertainty instead of success or auto-retry", async () => {
  fetchMock.mockRejectedValue(new Error("Offline"));
  await expect(
    executeAssistantAction(
      { kind: "list_create", title: "Travel", type: "custom" },
      "key",
    ),
  ).rejects.toThrow("Check the app");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("creates weekly chores through the canonical weekday rule and user-chosen assignee", async () => {
  jest.useFakeTimers({ now: new Date(2026, 9, 9, 12) });
  fetchMock.mockResolvedValue(ok({ chore: { id: "c" } }));
  await executeAssistantAction(
    {
      kind: "chore_create",
      title: "Recycling",
      frequency: "weekly",
      weekdays: [1, 4],
      points: 10,
      difficulty: "easy",
    },
    "key",
    { id: "member-a", title: "Avery" },
  );
  expect(fetchMock.mock.calls[0][0]).toBe("/api/chores/create");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
    assigned_to: "member-a",
    weekly_days: [1, 4],
    due_date: "2026-10-12",
    frequency: "weekly",
  });
  jest.useRealTimers();
});
