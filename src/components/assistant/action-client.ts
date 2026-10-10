import type { ZodTypeAny, infer as ZodInfer } from "zod";
import type { AssistantAction } from "@/lib/assistant-actions";
import { nextSelectedWeekday } from "@/lib/chore-weekdays";
import {
  parseDateOnly,
  toDateOnlyLocal,
  localDateTimeToISO,
} from "@/lib/dates";
import {
  createChoreSchema,
  createEventSchema,
  createListSchema,
  createNoteSchema,
} from "@/lib/validations";
function validated<T extends ZodTypeAny>(
  schema: T,
  input: unknown,
): ZodInfer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(
      result.error.issues[0]?.message ?? "Check the proposed details.",
    );
  return result.data;
}
export type RemovalTarget = { id: string; title: string; detail?: string };
export class ActionOutcomeUnknown extends Error {}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ActionOutcomeUnknown(
      method === "GET"
        ? "Could not load choices."
        : "The connection ended before confirmation. Check the app before trying this action again.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      data?.error || "Action failed. Check the app before retrying.",
    );
  if (!data)
    throw new ActionOutcomeUnknown(
      "The server response was unreadable. Check the app before trying again.",
    );
  return data;
}
export async function removalTargets(
  action: AssistantAction,
): Promise<RemovalTarget[]> {
  const domain =
    action.kind === "event_delete"
      ? "events"
      : action.kind === "chore_delete"
        ? "chores"
        : action.kind === "list_delete"
          ? "lists"
          : null;
  if (!domain) return [];
  const data = await request(`/api/${domain}`);
  return (data[domain] ?? [])
    .filter(
      (r: { source_subscription_id?: string | null }) =>
        !r.source_subscription_id,
    )
    .map(
      (r: {
        id: string;
        title?: string;
        name?: string;
        due_date?: string;
        start_time?: string;
      }) => ({
        id: r.id,
        title: r.title ?? r.name ?? "Untitled",
        detail: r.due_date ?? r.start_time,
      }),
    )
    .slice(0, 100);
}
export async function choreAssignees(): Promise<RemovalTarget[]> {
  const { members } = await request("/api/family/members");
  return (members ?? []).map((m: { id: string; name: string }) => ({
    id: m.id,
    title: m.name,
  }));
}
/** Only fixed routes/bodies, never an AI-provided URL or arbitrary HTTP tool. */
export async function executeAssistantAction(
  action: AssistantAction,
  key: string,
  target?: RemovalTarget,
) {
  if (action.kind === "chore_create") {
    if (!target) throw new Error("Choose who does this chore.");
    const anchor =
      action.frequency === "weekly"
        ? nextSelectedWeekday(
            parseDateOnly(toDateOnlyLocal(new Date()))!,
            action.weekdays,
            true,
          )
            ?.toISOString()
            .slice(0, 10)
        : action.date;
    if (!anchor || !parseDateOnly(anchor))
      throw new Error("Choose a valid date or at least one weekly day.");
    return request(
      "/api/chores/create",
      "POST",
      validated(createChoreSchema, {
        title: action.title,
        assigned_to: target.id,
        due_date: anchor,
        frequency: action.frequency,
        points: action.points,
        difficulty: action.difficulty,
        ...(action.frequency === "weekly"
          ? { weekly_days: action.weekdays }
          : {}),
      }),
    );
  }
  if (action.kind.endsWith("_delete")) {
    if (!target) throw new Error("Choose the exact item to remove.");
    const config =
      action.kind === "event_delete"
        ? { path: "/api/events", field: "eventId" }
        : action.kind === "chore_delete"
          ? { path: "/api/chores", field: "choreId" }
          : { path: "/api/lists", field: "listId" };
    return request(config.path, "DELETE", { [config.field]: target.id });
  }
  if (action.kind === "event_create") {
    const start = localDateTimeToISO(action.start),
      end = localDateTimeToISO(action.end);
    if (!start || !end || Date.parse(end) <= Date.parse(start))
      throw new Error(
        "Choose a valid start and later end time. Daylight-saving gaps need another time.",
      );
    const body = validated(createEventSchema, {
      title: action.title,
      start_time: start,
      end_time: end,
      location: action.location,
      event_type: "other",
    });
    return request("/api/events", "POST", body);
  }
  if (action.kind === "list_create")
    return request(
      "/api/lists/create",
      "POST",
      validated(createListSchema, { name: action.title, type: action.type }),
    );
  if (action.kind === "note_create")
    return request(
      "/api/notes",
      "POST",
      validated(createNoteSchema, {
        title: action.title,
        body: action.body,
        color: "yellow",
      }),
    );
  if (action.kind === "grocery_add") {
    const { lists } = await request("/api/lists");
    const groceries = (lists as Array<{ id: string; type: string }>).filter(
      (l) => l.type === "grocery",
    );
    if (groceries.length !== 1)
      throw new Error(
        "Choose a grocery list in Lists first. Chat adds only when there is exactly one grocery list.",
      );
    return request(
      "/api/lists/items/create",
      "POST",
      { listId: groceries[0].id, content: action.title, quantity: 1 },
      key,
    );
  }
  throw new Error("Open this section to continue.");
}
