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

export const defaultEnglishError = {
  checkProposedDetails: { message: "Check the proposed details." },
  loadChoicesFailed: { message: "Could not load choices." },
  connectionInterrupted: {
    message:
      "The connection ended before confirmation. Check the app before trying this action again.",
  },
  unreadableResponse: {
    message:
      "The server response was unreadable. Check the app before trying again.",
  },
  duplicateListTargets: {
    message:
      "Some lists have identical names and details. Open Lists to review or rename them before removing a list in chat.",
  },
  chooseChoreAssignee: { message: "Choose who does this chore." },
  invalidChoreSchedule: {
    message: "Choose a valid date or at least one weekly day.",
  },
  chooseRemovalTarget: { message: "Choose the exact item to remove." },
  invalidEventTime: {
    message:
      "Choose a valid start and later end time. Daylight-saving gaps need another time.",
  },
  chooseGroceryList: {
    message:
      "Choose a grocery list in Lists first. Chat adds only when there is exactly one grocery list.",
  },
  actionOpenSectionError: { message: "Open this section to continue." },
  actionFailed: { message: "Action failed. Check the app before retrying." },
} as const;

export type AssistantActionErrorCode = keyof typeof defaultEnglishError;

export class AssistantActionError extends Error {
  readonly code: AssistantActionErrorCode;

  constructor(code: AssistantActionErrorCode, message?: string) {
    super(message ?? defaultEnglishError[code].message);
    this.name = "AssistantActionError";
    this.code = code;
  }
}

function validated<T extends ZodTypeAny>(
  schema: T,
  input: unknown,
): ZodInfer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AssistantActionError(
      "checkProposedDetails",
      result.error.issues[0]?.message ?? undefined,
    );
  return result.data;
}
export type RemovalTarget = {
  id: string;
  title: string;
  detail?: string;
  context?: string;
};
export class ActionOutcomeUnknown extends AssistantActionError {}
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
      method === "GET" ? "loadChoicesFailed" : "connectionInterrupted",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (data?.error) throw new Error(data.error);
    throw new AssistantActionError("actionFailed");
  }
  if (!data) throw new ActionOutcomeUnknown("unreadableResponse");
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
  const targets: RemovalTarget[] = (data[domain] ?? [])
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
        type?: string;
        description?: string | null;
        creator?: { name?: string | null };
        _count?: { items?: number };
      }) => ({
        id: r.id,
        title: r.title ?? r.name ?? "Untitled",
        detail: r.due_date ?? r.start_time,
        context:
          domain === "lists"
            ? [
                r.type,
                r.description,
                r.creator?.name,
                r._count?.items === undefined
                  ? undefined
                  : `${r._count.items} items`,
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined,
      }),
    )
    .slice(0, 100);
  if (domain === "lists") {
    const labels = targets.map((t) => `${t.title} · ${t.context ?? ""}`);
    if (new Set(labels).size !== labels.length) {
      throw new AssistantActionError("duplicateListTargets");
    }
  }
  return targets;
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
    if (!target) throw new AssistantActionError("chooseChoreAssignee");
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
      throw new AssistantActionError("invalidChoreSchedule");
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
    if (!target) throw new AssistantActionError("chooseRemovalTarget");
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
      throw new AssistantActionError("invalidEventTime");
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
      throw new AssistantActionError("chooseGroceryList");
    return request(
      "/api/lists/items/create",
      "POST",
      { listId: groceries[0].id, content: action.title, quantity: 1 },
      key,
    );
  }
  throw new AssistantActionError("actionOpenSectionError");
}
