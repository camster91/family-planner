// Browser helper behind AddToGroceriesButton (#253): one key per intent,
// retry classification, and the toast copy.
import {
  postAddFromRecipe,
  postUndoAdd,
  summarizeAdd,
  summarizeUndo,
  undoRemainingMs,
  type AddFromRecipeResult,
} from "@/lib/add-to-groceries-client";

const KEY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

const result: AddFromRecipeResult = {
  listId: "l1",
  listName: "Groceries",
  requestId: "r1",
  createdCount: 3,
  alreadyOnListCount: 0,
  possibleDuplicates: [],
  possibleDuplicatesTruncated: false,
};

describe("postAddFromRecipe", () => {
  it.each([
    null,
    undefined,
    123,
    false,
    [],
    { toString: null },
    "",
    "not-a-date",
  ])(
    "classifies a supplied malformed undo expiry %p as retryable",
    async (undoExpiresAt) => {
      const out = await postAddFromRecipe({ recipeId: "rc" }, KEY, async () =>
        response(201, { ...result, undoExpiresAt }),
      );
      expect(out).toMatchObject({ kind: "retry" });
    },
  );

  it.each(["2026-09-28T12:02:00Z", "2026-09-28T12:02:00.123Z"])(
    "accepts a valid undo expiry %s unchanged",
    async (undoExpiresAt) => {
      const body = { ...result, undoExpiresAt };
      expect(
        await postAddFromRecipe({ recipeId: "rc" }, KEY, async () =>
          response(201, body),
        ),
      ).toEqual({ kind: "ok", result: body, replayed: false });
    },
  );
  it("retains the intent for retry when a successful write response is unreadable or incomplete", async () => {
    for (const body of [null, {}, { requestId: "r" }]) {
      expect(
        await postAddFromRecipe({ recipeId: "rc" }, KEY, async () =>
          response(201, body),
        ),
      ).toMatchObject({
        kind: "retry",
      });
    }
  });
  it("freezes the serialized body before automatic in-progress retries", async () => {
    const request = { recipeId: "rc", ingredientIds: ["i"] };
    const fetchImpl = jest.fn(async (_url: string, _init?: RequestInit) =>
      response(409, { error: { code: "IDEMPOTENCY_IN_PROGRESS" } }),
    );
    fetchImpl
      .mockImplementationOnce(async () =>
        response(409, { error: { code: "IDEMPOTENCY_IN_PROGRESS" } }),
      )
      .mockImplementationOnce(async () => response(201, result));
    await postAddFromRecipe(request, KEY, fetchImpl, async () => {
      request.recipeId = "other";
      request.ingredientIds.push("other");
    });
    expect(fetchImpl.mock.calls[1][1]?.body).toBe(
      fetchImpl.mock.calls[0][1]?.body,
    );
  });

  it("sends the key and body and reports a replay", async () => {
    const fetchImpl = jest.fn(async () =>
      response(201, result, { "Idempotency-Replayed": "true" }),
    );
    const out = await postAddFromRecipe(
      { recipeId: "rc", mealId: "m" },
      KEY,
      fetchImpl,
    );
    expect(out).toEqual({ kind: "ok", result, replayed: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/lists/items/from-recipe");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(KEY);
    expect(JSON.parse(String(init.body))).toEqual({
      recipeId: "rc",
      mealId: "m",
    });
  });

  it("waits out IDEMPOTENCY_IN_PROGRESS with the same key, then gives up as retryable", async () => {
    const inProgress = () =>
      response(409, {
        error: {
          code: "IDEMPOTENCY_IN_PROGRESS",
          message: "x",
          retryable: true,
        },
      });
    const sleep = jest.fn(async () => undefined);
    const fetchImpl = jest.fn(async () => inProgress());
    fetchImpl
      .mockImplementationOnce(async () => inProgress())
      .mockImplementationOnce(async () => response(201, result));
    expect(
      await postAddFromRecipe({ recipeId: "rc" }, KEY, fetchImpl, sleep),
    ).toMatchObject({ kind: "ok" });
    expect(sleep).toHaveBeenCalledTimes(1);

    const always = jest.fn(async () => inProgress());
    expect(
      await postAddFromRecipe({ recipeId: "rc" }, KEY, always, sleep),
    ).toMatchObject({ kind: "retry" });
    expect(always).toHaveBeenCalledTimes(4);
    for (const call of always.mock.calls as unknown as Array<
      [string, RequestInit]
    >) {
      expect(new Headers(call[1].headers).get("Idempotency-Key")).toBe(KEY);
    }
  });

  it("classifies network failures and 5xx as retryable, other errors as final with the server message", async () => {
    const offline = jest.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await postAddFromRecipe({ recipeId: "rc" }, KEY, offline),
    ).toMatchObject({ kind: "retry" });
    expect(
      await postAddFromRecipe({ recipeId: "rc" }, KEY, async () =>
        response(500, { error: "boom" }),
      ),
    ).toMatchObject({
      kind: "retry",
    });
    expect(
      await postAddFromRecipe({ recipeId: "rc" }, KEY, async () =>
        response(404, {
          error: {
            code: "RECIPE_NOT_FOUND",
            message: "Recipe not found.",
            retryable: false,
          },
        }),
      ),
    ).toEqual({ kind: "error", message: "Recipe not found." });
    expect(
      await postAddFromRecipe({ recipeId: "rc" }, KEY, async () =>
        response(403, { error: "Forbidden" }),
      ),
    ).toEqual({
      kind: "error",
      message: "Forbidden",
    });
  });
});

describe("postUndoAdd", () => {
  it("returns the result or the server message", async () => {
    const ok = { requestId: "r1", removedCount: 2, keptCheckedCount: 0 };
    expect(await postUndoAdd("r1", async () => response(200, ok))).toEqual({
      ok: true,
      result: ok,
    });
    expect(
      await postUndoAdd("r1", async () =>
        response(409, {
          error: { code: "UNDO_WINDOW_EXPIRED", message: "Too late." },
        }),
      ),
    ).toEqual({ ok: false, message: "Too late.", retryable: false });
  });

  it("marks network failures, 5xx and in-progress as retryable so Undo stays offered", async () => {
    expect(
      await postUndoAdd("r1", async () => {
        throw new TypeError("offline");
      }),
    ).toMatchObject({ ok: false, retryable: true });
    expect(
      await postUndoAdd("r1", async () => response(503, null)),
    ).toMatchObject({ ok: false, retryable: true });
    expect(
      await postUndoAdd("r1", async () =>
        response(409, {
          error: { code: "UNDO_IN_PROGRESS", message: "Busy." },
        }),
      ),
    ).toMatchObject({ ok: false, retryable: true });
    expect(
      await postUndoAdd("r1", async () =>
        response(403, { error: "Forbidden" }),
      ),
    ).toMatchObject({
      ok: false,
      retryable: false,
    });
  });
});

describe("undoRemainingMs", () => {
  const WINDOW = 10 * 60 * 1000;
  const now = Date.parse("2026-09-28T12:00:00Z");
  const base = {
    listId: "l",
    listName: "G",
    requestId: "r",
    createdCount: 1,
    alreadyOnListCount: 0,
    possibleDuplicates: [],
    possibleDuplicatesTruncated: false,
  };

  it.each([
    null,
    undefined,
    123,
    false,
    [],
    { toString: null },
    Symbol("expiry"),
    BigInt(1),
    "",
    "not-a-date",
  ])(
    "safely falls back for malformed expiry %p without coercion",
    (undoExpiresAt) => {
      expect(
        undoRemainingMs(
          { ...base, undoExpiresAt } as unknown as AddFromRecipeResult,
          WINDOW,
          now,
        ),
      ).toBe(WINDOW);
    },
  );

  it("preserves milliseconds in a valid server expiry", () => {
    expect(
      undoRemainingMs(
        { ...base, undoExpiresAt: "2026-09-28T12:02:00.123Z" },
        WINDOW,
        now,
      ),
    ).toBe(120123);
  });

  it("counts down to the server expiry, so a late replay does not restart the window", () => {
    expect(
      undoRemainingMs(
        { ...base, undoExpiresAt: "2026-09-28T12:02:00Z" },
        WINDOW,
        now,
      ),
    ).toBe(2 * 60 * 1000);
    expect(
      undoRemainingMs(
        { ...base, undoExpiresAt: "2026-09-28T11:59:00Z" },
        WINDOW,
        now,
      ),
    ).toBe(0);
  });

  it("never exceeds the full window and falls back to it without an expiry", () => {
    expect(
      undoRemainingMs(
        { ...base, undoExpiresAt: "2026-09-28T13:00:00Z" },
        WINDOW,
        now,
      ),
    ).toBe(WINDOW);
    expect(undoRemainingMs(base, WINDOW, now)).toBe(WINDOW);
  });
});

describe("toast copy", () => {
  it("summarises added, already-on-list and possible duplicates", () => {
    expect(summarizeAdd(result)).toEqual({
      title: "Added 3 items to Groceries",
      details: [],
    });
    expect(
      summarizeAdd({ ...result, createdCount: 0, alreadyOnListCount: 3 }),
    ).toEqual({
      title: "Everything is already on Groceries",
      details: [],
    });
    const mixed = summarizeAdd({
      ...result,
      createdCount: 1,
      alreadyOnListCount: 2,
      possibleDuplicates: [{ ingredientId: "i", matchedItemId: "m" }],
    });
    expect(mixed.title).toBe("Added 1 item to Groceries");
    expect(mixed.details).toEqual([
      "2 items already on the list, not added again.",
      "1 may duplicate an item already typed on the list. Check before shopping.",
    ]);
    expect(
      summarizeAdd({
        ...result,
        possibleDuplicates: [{ ingredientId: "i", matchedItemId: "m" }],
        possibleDuplicatesTruncated: true,
      }).details[0],
    ).toMatch(/^1 or more may duplicate items/);
    expect(
      summarizeUndo({ requestId: "r", removedCount: 2, keptCheckedCount: 1 }),
    ).toBe("Removed 2 items (1 item already ticked, kept).");
    expect(
      summarizeUndo({ requestId: "r", removedCount: 0, keptCheckedCount: 0 }),
    ).toBe("Nothing left to remove.");
  });
});
