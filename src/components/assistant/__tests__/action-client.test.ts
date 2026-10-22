import {
  defaultEnglishError,
  executeAssistantAction,
  removalTargets,
  previewRemovalTarget,
  AssistantActionError,
  AssistantActionPreflightError,
  ActionOutcomeUnknown,
  AssistantSourceRefusal,
} from "../action-client";
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
it("tags grocery discovery failures as preflight but keeps item writes uncertain", async () => {
  fetchMock.mockRejectedValueOnce(new Error("Offline"));
  const discovery = executeAssistantAction(
    { kind: "grocery_add", title: "Milk" },
    "stable-key",
  );
  await expect(discovery).rejects.toBeInstanceOf(AssistantActionPreflightError);
  await expect(discovery).rejects.toMatchObject({ code: "loadChoicesFailed" });
  expect(fetchMock).toHaveBeenCalledTimes(1);

  fetchMock.mockReset();
  fetchMock
    .mockResolvedValueOnce(
      ok({ lists: [{ id: "grocery-a", type: "grocery" }] }),
    )
    .mockRejectedValueOnce(new Error("Offline after write started"));
  const itemWrite = executeAssistantAction(
    { kind: "grocery_add", title: "Milk" },
    "stable-key",
  );
  await expect(itemWrite).rejects.toBeInstanceOf(ActionOutcomeUnknown);
  await expect(itemWrite).rejects.toMatchObject({
    code: "connectionInterrupted",
  });
  await expect(itemWrite).rejects.not.toBeInstanceOf(
    AssistantActionPreflightError,
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
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
it("classifies a failed choice GET as safely reloadable", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    json: async () => ({ error: "Provider unavailable" }),
  });
  const result = removalTargets({ kind: "event_delete", title: "Dentist" });
  await expect(result).rejects.toBeInstanceOf(ActionOutcomeUnknown);
  await expect(result).rejects.toMatchObject({ code: "loadChoicesFailed" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
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
  const result = executeAssistantAction(
    { kind: "list_create", title: "Travel", type: "custom" },
    "key",
  );
  await expect(result).rejects.toThrow("Check the app");
  await expect(result).rejects.toBeInstanceOf(AssistantActionError);
  await expect(result).rejects.toMatchObject({
    code: "connectionInterrupted",
    message: defaultEnglishError.connectionInterrupted.message,
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("exposes a semantic code for local validation while retaining its English message", async () => {
  const result = executeAssistantAction(
    {
      kind: "event_create",
      title: "Bad",
      start: "2026-10-10T15:00",
      end: "2026-10-10T14:00",
    },
    "key",
  );
  await expect(result).rejects.toMatchObject({
    code: "invalidEventTime",
    message: defaultEnglishError.invalidEventTime.message,
  });
  await expect(result).rejects.toBeInstanceOf(AssistantActionPreflightError);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("localizes a missing server error through its semantic fallback and preserves server copy", async () => {
  const action = {
    kind: "list_create",
    title: "Travel",
    type: "custom",
  } as const;
  fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
  await expect(executeAssistantAction(action, "key")).rejects.toMatchObject({
    code: "actionFailed",
    message: defaultEnglishError.actionFailed.message,
  });
  fetchMock.mockResolvedValueOnce({
    ok: false,
    json: async () => ({ error: "Server supplied detail" }),
  });
  await expect(executeAssistantAction(action, "key")).rejects.toMatchObject({
    message: "Server supplied detail",
  });
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

/** Authored/unrun versioned confirmation transport cases. */
it("sends a reviewed context action only through the versioned canonical confirmation endpoint", async () => {
  fetchMock.mockResolvedValue(ok({ event: { id: "event-a" } }));
  await executeAssistantAction(
    {
      kind: "event_create",
      title: "Reviewed title",
      start: "2026-10-22T15:00",
      end: "2026-10-22T15:30",
    },
    "stable-reviewed-key",
    undefined,
    "fabricated-proof",
  );
  const [path, options] = fetchMock.mock.calls[0];
  expect(path).toBe("/api/assistant/actions/confirm");
  expect(options.headers["Idempotency-Key"]).toBe("stable-reviewed-key");
  expect(JSON.parse(options.body)).toMatchObject({
    kind: "event_create",
    sourceProof: "fabricated-proof",
    body: { title: "Reviewed title" },
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("distinguishes a proven source refusal from an unknown mutation result and never retries", async () => {
  fetchMock.mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      error: "Source unavailable",
      code: "ASSISTANT_SOURCE_REFUSED",
    }),
  });
  await expect(
    executeAssistantAction(
      {
        kind: "event_create",
        title: "Review",
        start: "2026-10-22T15:00",
        end: "2026-10-22T15:30",
      },
      "stable-key",
      undefined,
      "fabricated-proof",
    ),
  ).rejects.toBeInstanceOf(AssistantSourceRefusal);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("requires exact target proof before a sourced removal, then forwards it only to the fixed confirmation route", async () => {
  const action = { kind: "list_delete" as const, title: "Supplies" };
  await expect(
    executeAssistantAction(
      action,
      "synthetic-removal-key",
      { id: "list-a", title: "Supplies" },
      "source-proof",
    ),
  ).rejects.toBeInstanceOf(AssistantActionPreflightError);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(
    ok({
      target: {
        id: "list-a",
        title: "Current supplies",
        itemCount: 2,
        proof: "target-proof",
      },
    }),
  );
  const reviewed = await previewRemovalTarget(action, "list-a", "source-proof");
  expect(fetchMock.mock.calls[0][0]).toBe("/api/assistant/actions/target");
  fetchMock.mockResolvedValueOnce(ok({ success: true }));
  await executeAssistantAction(
    action,
    "synthetic-removal-key",
    reviewed,
    "source-proof",
  );
  const [path, options] = fetchMock.mock.calls[1];
  expect(path).toBe("/api/assistant/actions/confirm");
  expect(JSON.parse(options.body)).toEqual({
    kind: "list_delete",
    sourceProof: "source-proof",
    targetProof: "target-proof",
    body: { listId: "list-a" },
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
