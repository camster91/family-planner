/**
 * Browser side of the recipe → grocery add (ADR-0007 child D, #253), kept free
 * of React so it can be unit-tested. Used by
 * `src/components/meals/AddToGroceriesButton.tsx`.
 *
 * Retry rule: one user intent = one `Idempotency-Key`. The caller keeps the
 * key until the add has a definite answer, so a network failure or a
 * `409 IDEMPOTENCY_IN_PROGRESS` retried with the same key replays the first
 * result instead of adding twice. Not offline-queued (O-10).
 */
import type { RecipeGroceriesText } from "@/i18n/recipe-groceries";
import { IDEMPOTENCY_HEADER } from "@/lib/idempotency-key";

export interface AddFromRecipeRequest {
  recipeId: string;
  mealId?: string;
  batchId?: string;
  listId?: string;
  servings?: number;
  ingredientIds?: string[];
}

export interface AddFromRecipeResult {
  listId: string;
  listName: string;
  requestId: string;
  createdCount: number;
  alreadyOnListCount: number;
  possibleDuplicates: Array<{ ingredientId: string; matchedItemId: string }>;
  possibleDuplicatesTruncated: boolean;
  /** ISO time after which the server refuses undo (absent from older servers). */
  undoExpiresAt?: string;
}

export interface UndoAddResult {
  requestId: string;
  removedCount: number;
  keptCheckedCount: number;
}

export type AddOutcome =
  | { kind: "ok"; result: AddFromRecipeResult; replayed: boolean }
  /** Worth retrying with the SAME key (network failure, in progress, 5xx). */
  | { kind: "retry"; message: string }
  /** Definite refusal; a new attempt needs a new key. */
  | { kind: "error"; message: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const IN_PROGRESS_RETRIES = 3;

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === "string") return e;
    if (
      e &&
      typeof e === "object" &&
      typeof (e as { message?: unknown }).message === "string"
    ) {
      return (e as { message: string }).message;
    }
  }
  return fallback;
}

function errorCode(body: unknown): string | null {
  const e =
    body && typeof body === "object"
      ? (body as { error?: unknown }).error
      : null;
  return e &&
    typeof e === "object" &&
    typeof (e as { code?: unknown }).code === "string"
    ? (e as { code: string }).code
    : null;
}

const resultId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

function validAddResult(body: unknown, expectedListId: string | undefined): body is AddFromRecipeResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Partial<AddFromRecipeResult>;
  if (!resultId(value.requestId) || !resultId(value.listId) ||
    typeof value.listName !== "string" ||
    !Number.isSafeInteger(value.createdCount) || value.createdCount! < 0 ||
    !Number.isSafeInteger(value.alreadyOnListCount) || value.alreadyOnListCount! < 0 ||
    !Number.isSafeInteger(value.createdCount! + value.alreadyOnListCount!) ||
    !Array.isArray(value.possibleDuplicates) ||
    typeof value.possibleDuplicatesTruncated !== "boolean") return false;
  // The server normalizes ID whitespace but never substitutes another list
  // for an explicit destination. Missing listId still permits its default list.
  if (expectedListId !== undefined && value.listId !== expectedListId) return false;
  const duplicates = value.possibleDuplicates;
  if (duplicates.length > value.createdCount! || !duplicates.every(item =>
    item !== null && typeof item === "object" && !Array.isArray(item) &&
    resultId(item.ingredientId) && resultId(item.matchedItemId)) ||
    new Set(duplicates.map(item => item.ingredientId)).size !== duplicates.length) return false;
  return !("undoExpiresAt" in value) ||
    (typeof value.undoExpiresAt === "string" && Number.isFinite(Date.parse(value.undoExpiresAt)));
}

function validUndoResult(body: unknown, requestId: string): body is UndoAddResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const value = body as Partial<UndoAddResult>;
  return value.requestId === requestId &&
    Number.isSafeInteger(value.removedCount) && value.removedCount! >= 0 &&
    Number.isSafeInteger(value.keptCheckedCount) && value.keptCheckedCount! >= 0;
}

class GroceryReplyTimeout extends Error {}
/** Abort is best effort; a native bridge may ignore it or the server may commit. */
async function postJsonWithinDeadline(url: string, init: RequestInit, fetchImpl: FetchLike) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const res = await fetchImpl(url, { ...init, signal: controller.signal });
        const body: unknown = await res.json().catch(() => null);
        return { res, body };
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new GroceryReplyTimeout());
          controller.abort();
        }, 15_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postAddFromRecipe(
  request: AddFromRecipeRequest,
  key: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  sleep: (ms: number) => Promise<unknown> = wait,
): Promise<AddOutcome> {
  const frozenBody = JSON.stringify(request);
  const expectedListId = request.listId?.trim();
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    let body: unknown;
    try {
      ({ res, body } = await postJsonWithinDeadline("/api/lists/items/from-recipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: key,
        },
        body: frozenBody,
      }, fetchImpl));
    } catch (error) {
      return {
        kind: "retry",
        message: error instanceof GroceryReplyTimeout
          ? "Could not confirm the saved result. Try again to check the same request."
          : "Could not reach the server. Check the connection and try again.",
      };
    }
    if (res.ok) {
      // A committed write with a lost/truncated response is not a refusal.
      // Keep the original key so the next attempt can recover its replay.
      if (!validAddResult(body, expectedListId))
        return {
          kind: "retry",
          message:
            "Could not confirm the saved result. Try again to check the same request.",
        };
      return {
        kind: "ok",
        result: body,
        replayed: res.headers.get("Idempotency-Replayed") === "true",
      };
    }
    if (res.status === 409 && errorCode(body) === "IDEMPOTENCY_IN_PROGRESS") {
      if (attempt < IN_PROGRESS_RETRIES) {
        await sleep(1000);
        continue;
      }
      return { kind: "retry", message: "Still saving. Try again in a moment." };
    }
    if (res.status >= 500)
      return { kind: "retry", message: "Something went wrong. Try again." };
    return {
      kind: "error",
      message: errorMessage(body, "Could not add the ingredients."),
    };
  }
}

export type UndoOutcome =
  | { ok: true; result: UndoAddResult }
  /** `retryable`: network failure, 5xx or still in progress; the same request can be sent again. */
  | { ok: false; message: string; retryable: boolean };

export async function postUndoAdd(
  requestId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<UndoOutcome> {
  let res: Response;
  let body: unknown;
  try {
    ({ res, body } = await postJsonWithinDeadline("/api/lists/items/undo-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    }, fetchImpl));
  } catch (error) {
    return {
      ok: false,
      message: error instanceof GroceryReplyTimeout
        ? "Could not confirm Undo. Try again to check the same request."
        : "Could not reach the server. Try again.",
      retryable: true,
    };
  }
  if (res.ok) {
    if (validUndoResult(body, requestId)) return { ok: true, result: body };
    // A malformed successful reply cannot establish whether Undo committed.
    return { ok: false, retryable: true,
      message: "Could not confirm Undo. Try again to check the same request." };
  }
  const retryable =
    res.status >= 500 ||
    (res.status === 409 && errorCode(body) === "UNDO_IN_PROGRESS");
  return {
    ok: false,
    message: errorMessage(body, "Could not undo."),
    retryable,
  };
}

/**
 * Milliseconds Undo should stay offered: until the server's `undoExpiresAt`,
 * never longer than the full window (guards against a skewed device clock).
 */
export function undoRemainingMs(
  result: AddFromRecipeResult,
  windowMs: number,
  now: number = Date.now(),
): number {
  const expires =
    typeof result.undoExpiresAt === "string"
      ? Date.parse(result.undoExpiresAt)
      : NaN;
  if (Number.isNaN(expires)) return windowMs;
  return Math.max(0, Math.min(windowMs, expires - now));
}

const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;

/** Toast copy: what was added, what was already there, what may be a duplicate. */
type SummaryCopy = { text: RecipeGroceriesText; number: (value: number) => string };
export function summarizeAdd(result: AddFromRecipeResult, copy?: SummaryCopy): {
  title: string;
  details: string[];
} {
  const { createdCount, alreadyOnListCount, listName } = result;
  if (copy) {
    const { text, number } = copy;
    const countItems = (count: number) => text(count === 1 ? "itemOne" : "itemMany", { count: number(count) });
    const title = createdCount > 0 ? text(createdCount === 1 ? "addedOne" : "addedMany", { items: countItems(createdCount), list: listName }) : text("alreadyAll", { list: listName });
    const details: string[] = [];
    if (createdCount > 0 && alreadyOnListCount > 0) details.push(text("already", { items: countItems(alreadyOnListCount) }));
    const count = result.possibleDuplicates.length;
    if (count > 0) details.push(text(result.possibleDuplicatesTruncated ? "duplicateMore" : count === 1 ? "duplicateOne" : "duplicateMany", { count: number(count) }));
    return { title, details };
  }
  const title =
    createdCount > 0
      ? `Added ${items(createdCount)} to ${listName}`
      : `Everything is already on ${listName}`;
  const details: string[] = [];
  if (createdCount > 0 && alreadyOnListCount > 0) {
    details.push(
      `${items(alreadyOnListCount)} already on the list, not added again.`,
    );
  }
  const dupes = result.possibleDuplicates.length;
  if (dupes > 0) {
    const more = result.possibleDuplicatesTruncated ? " or more" : "";
    details.push(
      `${dupes}${more} may duplicate ${dupes === 1 && !more ? "an item" : "items"} already typed on the list. Check before shopping.`,
    );
  }
  return { title, details };
}

export function summarizeUndo(result: UndoAddResult, copy?: SummaryCopy): string {
  if (copy) {
    const { text, number } = copy;
    const countItems = (count: number) => text(count === 1 ? "itemOne" : "itemMany", { count: number(count) });
    return text("undone", {
      removed: result.removedCount === 0 ? text("removedNone") : text(result.removedCount === 1 ? "removedOne" : "removedMany", { items: countItems(result.removedCount) }),
      kept: result.keptCheckedCount > 0 ? text("kept", { items: countItems(result.keptCheckedCount) }) : "",
    });
  }
  const removed =
    result.removedCount === 0
      ? "Nothing left to remove"
      : `Removed ${items(result.removedCount)}`;
  const kept =
    result.keptCheckedCount > 0
      ? ` (${items(result.keptCheckedCount)} already ticked, kept)`
      : "";
  return `${removed}${kept}.`;
}
