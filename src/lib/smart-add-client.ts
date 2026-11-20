/**
 * Browser side of smart Add (#144), free of React so it can be unit-tested.
 * Every confirmed row is saved through an EXISTING canonical create route with
 * its own Idempotency-Key, kept until the row has a definite answer, so a
 * retry never adds twice. No AI here: drafts come from /api/ai/smart-add, or
 * from the local comma split when AI is off, unavailable or offline.
 */
import { IDEMPOTENCY_HEADER, newIdempotencyKey } from "@/lib/idempotency-key";

export const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export type SmartPerson = {
  kind: "account" | "profile";
  id: string;
  name: string;
};
export type SmartList = { id: string; name: string };

export type SmartRow =
  | {
      id: string;
      kind: "event";
      title: string;
      date: string;
      startTime: string | null;
      endTime: string | null;
      people: SmartPerson[];
      checkPeople: boolean;
    }
  | {
      id: string;
      kind: "chore";
      title: string;
      dueDate: string | null;
      assignee: SmartPerson | null;
      checkPeople: boolean;
    }
  | {
      id: string;
      kind: "grocery";
      title: string;
      quantity: number;
      list: SmartList | null;
    }
  | { id: string; kind: "meal"; title: string; date: string; slot: MealSlot };

const MAX_FALLBACK_ITEMS = 20;

/**
 * Offline/AI-off fallback: split a typed line into grocery items on commas,
 * semicolons, new lines and a final "and" ("milk, eggs and bread"). A leading
 * whole number becomes the quantity ("2 milk").
 */
export function splitGroceryText(
  text: string,
): Array<{ title: string; quantity: number }> {
  const parts = text
    .split(/[,;\n]+|\s+and\s+/i)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: Array<{ title: string; quantity: number }> = [];
  for (const part of parts) {
    if (out.length >= MAX_FALLBACK_ITEMS) break;
    const m = /^(\d{1,2})\s*x?\s+(.+)$/i.exec(part);
    const quantity = m ? Math.min(99, Math.max(1, Number(m[1]))) : 1;
    const title = (m ? m[2] : part).slice(0, 200).trim();
    if (title) out.push({ title, quantity });
  }
  return out;
}

export function fallbackGroceryRows(text: string): SmartRow[] {
  return splitGroceryText(text).map((item, index) => ({
    id: `g${index}`,
    kind: "grocery",
    title: item.title,
    quantity: item.quantity,
    list: null,
  }));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** The viewer's local date, time and zone, sent so the server resolves "Tue". */
export function viewerNow(now: Date = new Date()) {
  let timeZone = "UTC";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* keep UTC */
  }
  return {
    localDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    timeZone,
  };
}

/** A local wall time in the browser's zone as an ISO instant. */
export function localInstant(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
}

/** Why a row cannot be added yet, or null when it is ready. */
export function rowProblem(
  row: SmartRow,
  role: string,
): "needsTime" | "needsAssignee" | "parentsOnlyChores" | null {
  if (row.kind === "event" && !row.startTime) return "needsTime";
  if (row.kind === "chore" && role !== "parent") return "parentsOnlyChores";
  if (row.kind === "chore" && !row.assignee) return "needsAssignee";
  return null;
}

export type SavePlan = { url: string; method: "POST"; body: unknown };

/** The canonical create request for one reviewed row. */
export function savePlanFor(
  row: SmartRow,
  context: {
    peopleOnEvents: boolean;
    meal?: { userId: string; familyId: string };
    today: string;
  },
): SavePlan {
  switch (row.kind) {
    case "event": {
      const start = localInstant(row.date, row.startTime ?? "09:00");
      return {
        url: "/api/events",
        method: "POST",
        body: {
          title: row.title.trim(),
          start_time: start,
          ...(row.endTime && row.endTime > (row.startTime ?? "")
            ? { end_time: localInstant(row.date, row.endTime) }
            : {}),
          event_type: "other",
          ...(context.peopleOnEvents && row.people.length
            ? {
                participants: row.people.map((p) => ({
                  kind: p.kind,
                  id: p.id,
                })),
              }
            : {}),
        },
      };
    }
    case "chore":
      return {
        url: "/api/chores/create",
        method: "POST",
        body: {
          title: row.title.trim(),
          assigned_to: row.assignee?.id,
          due_date: row.dueDate ?? context.today,
          frequency: "once",
        },
      };
    case "grocery":
      return row.list
        ? {
            url: "/api/lists/items/create",
            method: "POST",
            body: {
              listId: row.list.id,
              content: row.title.trim(),
              quantity: row.quantity,
            },
          }
        : {
            url: "/api/capture/grocery",
            method: "POST",
            body: { content: row.title.trim(), quantity: row.quantity },
          };
    case "meal":
      if (!context.meal) throw new Error("Meal owner is required");
      return {
        url: "/api/meals/create",
        method: "POST",
        body: {
          protocol: "herewoven.meal-create.v1",
          expected_user_id: context.meal.userId,
          expected_family_id: context.meal.familyId,
          issued_at: new Date().toISOString(),
          date: row.date,
          meal_type: row.slot,
          recipe_name: row.title.trim(),
        },
      };
  }
}

/** The created record's id from a canonical create reply (shapes differ by route). */
export function createdIdOf(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const candidates = [
    b.id,
    b.mealId,
    (b.event as Record<string, unknown> | undefined)?.id,
    (b.item as Record<string, unknown> | undefined)?.id,
    (b.chore as Record<string, unknown> | undefined)?.id,
    (b.meal as Record<string, unknown> | undefined)?.id,
  ];
  const found = candidates.find((v) => typeof v === "string" && v.length > 0);
  return (found as string | undefined) ?? null;
}

export type SavedRecord = { kind: SmartRow["kind"]; id: string };

/** The canonical delete request used by Undo (parents only; same routes as by hand). */
export function undoPlanFor(
  saved: SavedRecord,
  meal?: { userId: string; familyId: string; generation?: number },
): { url: string; method: "DELETE"; body?: unknown } {
  switch (saved.kind) {
    case "event":
      return {
        url: "/api/events",
        method: "DELETE",
        body: { eventId: saved.id },
      };
    case "chore":
      return {
        url: "/api/chores",
        method: "DELETE",
        body: { choreId: saved.id },
      };
    case "grocery":
      return {
        url: `/api/lists/items/${encodeURIComponent(saved.id)}`,
        method: "DELETE",
      };
    case "meal": {
      const q = new URLSearchParams({ id: saved.id });
      // The route checks the expected owner only as a complete triple.
      if (meal && meal.generation !== undefined) {
        q.set("expected_user_id", meal.userId);
        q.set("expected_family_id", meal.familyId);
        q.set("expected_generation", String(meal.generation));
      }
      return {
        url: `/api/meals/${encodeURIComponent(saved.id)}?${q}`,
        method: "DELETE",
      };
    }
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Send one keyed request. The caller keeps `key` until the answer is definite. */
export async function sendKeyed(
  plan: { url: string; method: string; body?: unknown },
  key: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetchImpl(plan.url, {
    method: plan.method,
    headers: {
      ...(plan.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      [IDEMPOTENCY_HEADER]: key,
    },
    body: plan.body === undefined ? undefined : JSON.stringify(plan.body),
    credentials: "same-origin",
    cache: "no-store",
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

export { newIdempotencyKey };
