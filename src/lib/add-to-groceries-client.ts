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
import { IDEMPOTENCY_HEADER } from "@/lib/idempotency-key";

export interface AddFromRecipeRequest {
  recipeId: string;
  mealId?: string;
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

function validAddResult(body: unknown): body is AddFromRecipeResult {
  if (!body || typeof body !== "object") return false;
  const value = body as Partial<AddFromRecipeResult>;
  return (
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    typeof value.listId === "string" &&
    typeof value.listName === "string" &&
    Number.isInteger(value.createdCount) &&
    value.createdCount! >= 0 &&
    Number.isInteger(value.alreadyOnListCount) &&
    value.alreadyOnListCount! >= 0 &&
    Array.isArray(value.possibleDuplicates) &&
    typeof value.possibleDuplicatesTruncated === "boolean" &&
    (!("undoExpiresAt" in value) ||
      (typeof value.undoExpiresAt === "string" &&
        Number.isFinite(Date.parse(value.undoExpiresAt))))
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function postAddFromRecipe(
  request: AddFromRecipeRequest,
  key: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  sleep: (ms: number) => Promise<unknown> = wait,
): Promise<AddOutcome> {
  const frozenBody = JSON.stringify(request);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl("/api/lists/items/from-recipe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [IDEMPOTENCY_HEADER]: key,
        },
        body: frozenBody,
      });
    } catch {
      return {
        kind: "retry",
        message:
          "Could not reach the server. Check the connection and try again.",
      };
    }
    const body = await res.json().catch(() => null);
    if (res.ok) {
      // A committed write with a lost/truncated response is not a refusal.
      // Keep the original key so the next attempt can recover its replay.
      if (!validAddResult(body))
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
  try {
    res = await fetchImpl("/api/lists/items/undo-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
  } catch {
    return {
      ok: false,
      message: "Could not reach the server. Try again.",
      retryable: true,
    };
  }
  const body = await res.json().catch(() => null);
  if (res.ok && body) return { ok: true, result: body as UndoAddResult };
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
export function summarizeAdd(result: AddFromRecipeResult): {
  title: string;
  details: string[];
} {
  const { createdCount, alreadyOnListCount, listName } = result;
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

export function summarizeUndo(result: UndoAddResult): string {
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
