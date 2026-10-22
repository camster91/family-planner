import { z } from "zod";
import { profileChoreCreateSchema } from "@/lib/profile-chore-create-contract";
import { readHouseholdProfilesResponse } from "@/lib/household-profile-types";
import {
  memberIdentityIdSchema,
  isProfileAgeAllowed,
} from "@/lib/member-subject-contract";
import {
  assistantDeleteKind,
  assistantDeletePreviewSchema,
} from "@/lib/assistant-reference-contract";
import { requestOwnedJson } from "@/lib/owned-request-http";
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
  assigneeChanged: {
    message:
      "This family member changed or is unavailable. Reload the choices and review who does this chore.",
  },
  profileRecurrenceUnavailable: {
    message:
      "Repeating chores are paused for this profile. Choose Once or keep the draft and use Chores.",
  },
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
  sourceChanged: {
    message:
      "The source information changed or expired. Refresh Today to review this proposal again.",
  },
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

/** Proven no new effect: local validation or a canonical pre-effect refusal. */
export class AssistantActionPreflightError extends AssistantActionError {}

function validated<T extends ZodTypeAny>(
  schema: T,
  input: unknown,
): ZodInfer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AssistantActionPreflightError(
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
  proof?: string;
  itemCount?: number;
  subject?:
    | { kind: "account"; accountId: string }
    | {
        kind: "profile";
        memberId: string;
        revision: number;
        recurrenceSupported: boolean;
      };
};
export class ActionOutcomeUnknown extends AssistantActionError {}
export class AssistantSourceRefusal extends AssistantActionError {
  constructor() {
    super("sourceChanged");
  }
}
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
) {
  const result = await requestOwnedJson(path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (result.kind !== "reply")
    throw new ActionOutcomeUnknown(
      method === "GET" ? "loadChoicesFailed" : "connectionInterrupted",
    );
  const response = result.response,
    data: any = result.body;
  if (response.status === 409 && data?.code === "ASSISTANT_SOURCE_REFUSED")
    throw new AssistantSourceRefusal();
  if (!response.ok) {
    // A roster read is safe to reload and must keep the proposal in place.
    if (method === "GET") throw new ActionOutcomeUnknown("loadChoicesFailed");
    // These canonical profile failures are before the effect or roll back its
    // transaction. Preserve the editable proposal and reload canonical choices.
    if (
      [404, 409].includes(response.status) &&
      [
        "PROFILE_TARGET_CONFLICT",
        "PROFILE_TARGET_UNAVAILABLE",
        "MEMBER_PROTOCOL_UNAVAILABLE",
      ].includes(data?.error)
    )
      throw new AssistantActionPreflightError("assigneeChanged");
    if (data?.error) throw new Error(data.error);
    throw new AssistantActionError("actionFailed");
  }
  if (!data) throw new ActionOutcomeUnknown("unreadableResponse");
  return data;
}
async function mutate(
  kind: AssistantAction["kind"],
  path: string,
  method: string,
  body: unknown,
  key: string,
  sourceProof?: string,
  targetProof?: string,
) {
  if (kind === "open")
    throw new AssistantActionPreflightError("actionOpenSectionError");
  return sourceProof
    ? request(
        "/api/assistant/actions/confirm",
        "POST",
        { kind, sourceProof, body, ...(targetProof ? { targetProof } : {}) },
        key,
      )
    : request(path, method, body, key);
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
/** Read-only POST: review one selected target; no mutation or key consumed. */
export async function previewRemovalTarget(
  action: AssistantAction,
  id: string,
  sourceProof: string,
): Promise<RemovalTarget> {
  const kind = assistantDeleteKind.safeParse(action.kind);
  if (!kind.success)
    throw new AssistantActionPreflightError("chooseRemovalTarget");
  try {
    const result = await request("/api/assistant/actions/target", "POST", {
      kind: kind.data,
      id,
      sourceProof,
    });
    const parsed = assistantDeletePreviewSchema.safeParse(result.target);
    if (!parsed.success || parsed.data.id !== id)
      throw new AssistantActionPreflightError("loadChoicesFailed");
    return parsed.data;
  } catch (error) {
    if (error instanceof AssistantSourceRefusal) throw error;
    throw new AssistantActionPreflightError("loadChoicesFailed");
  }
}
export async function choreAssignees(
  includeProfiles = false,
): Promise<RemovalTarget[]> {
  const [accounts, profilesBody] = await Promise.all([
    request("/api/family/members"),
    includeProfiles ? request("/api/family/profiles") : Promise.resolve(null),
  ]);
  const parsedMembers = z
    .array(
      z.object({
        id: memberIdentityIdSchema,
        name: z.string().trim().min(1).max(100),
      }),
    )
    .max(150)
    .safeParse(accounts.members);
  if (!parsedMembers.success)
    throw new ActionOutcomeUnknown("loadChoicesFailed");
  const members = parsedMembers.data;
  const result: RemovalTarget[] = members.map(
    (m: { id: string; name: string }) => ({
      id: includeProfiles ? `account:${m.id}` : m.id,
      title: m.name,
      subject: { kind: "account", accountId: m.id },
    }),
  );
  if (!includeProfiles) return result;
  const profiles = readHouseholdProfilesResponse(profilesBody);
  if (
    !profiles ||
    !profiles.profileChoreSupported ||
    profiles.profiles.length + result.length > 150 ||
    profiles.profiles.some(
      (profile) =>
        !memberIdentityIdSchema.safeParse(profile.id).success ||
        profile.name.length > 100 ||
        !isProfileAgeAllowed(profile.role, profile.age) ||
        profile.revision < 0 ||
        profile.revision > 2147483647 ||
        (profile.archived_at !== null &&
          !Number.isFinite(Date.parse(profile.archived_at))),
    )
  )
    throw new ActionOutcomeUnknown("loadChoicesFailed");
  for (const profile of profiles.profiles.filter((item) => !item.archived_at))
    result.push({
      id: `profile:${profile.id}`,
      title: profile.name,
      subject: {
        kind: "profile",
        memberId: profile.id,
        revision: profile.revision,
        recurrenceSupported: profiles.profileChoreRecurrenceSupported === true,
      },
    });
  if (new Set(result.map((target) => target.id)).size !== result.length)
    throw new ActionOutcomeUnknown("loadChoicesFailed");
  return result;
}
/** Only fixed routes/bodies, never an AI-provided URL or arbitrary HTTP tool. */
export async function executeAssistantAction(
  action: AssistantAction,
  key: string,
  target?: RemovalTarget,
  sourceProof?: string,
) {
  if (action.kind === "chore_create") {
    if (!target) throw new AssistantActionPreflightError("chooseChoreAssignee");
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
      throw new AssistantActionPreflightError("invalidChoreSchedule");
    if (target.subject?.kind === "profile") {
      if (action.frequency !== "once" && !target.subject.recurrenceSupported)
        throw new AssistantActionPreflightError("profileRecurrenceUnavailable");
      const body = validated(profileChoreCreateSchema, {
        protocol: 2,
        selection: { memberId: target.subject.memberId },
        title: action.title,
        due_date: anchor,
        frequency: action.frequency,
        points: action.points,
        difficulty: action.difficulty,
        weekly_days: action.frequency === "weekly" ? action.weekdays : [],
      });
      // Versioned delegation also enforces revision checks for a manual profile
      // proposal without Include Today. No unchecked old-server fallback.
      const result = await request(
        "/api/assistant/actions/confirm",
        "POST",
        {
          kind: action.kind,
          body,
          profileRevision: target.subject.revision,
          ...(sourceProof ? { sourceProof } : {}),
        },
        key,
      );
      if (
        typeof result.choreId !== "string" ||
        !memberIdentityIdSchema.safeParse(result.choreId).success
      )
        throw new ActionOutcomeUnknown("unreadableResponse");
      return result;
    }
    return mutate(
      action.kind,
      "/api/chores/create",
      "POST",
      validated(createChoreSchema, {
        title: action.title,
        assigned_to:
          target.subject?.kind === "account"
            ? target.subject.accountId
            : target.id,
        due_date: anchor,
        frequency: action.frequency,
        points: action.points,
        difficulty: action.difficulty,
        ...(action.frequency === "weekly"
          ? { weekly_days: action.weekdays }
          : {}),
      }),
      key,
      sourceProof,
    );
  }
  if (action.kind.endsWith("_delete")) {
    if (!target || (sourceProof && !target.proof))
      throw new AssistantActionPreflightError("chooseRemovalTarget");
    const config =
      action.kind === "event_delete"
        ? { path: "/api/events", field: "eventId" }
        : action.kind === "chore_delete"
          ? { path: "/api/chores", field: "choreId" }
          : { path: "/api/lists", field: "listId" };
    return mutate(
      action.kind,
      config.path,
      "DELETE",
      { [config.field]: target.id },
      key,
      sourceProof,
      target.proof,
    );
  }
  if (action.kind === "event_create") {
    const start = localDateTimeToISO(action.start),
      end = localDateTimeToISO(action.end);
    if (!start || !end || Date.parse(end) <= Date.parse(start))
      throw new AssistantActionPreflightError("invalidEventTime");
    const body = validated(createEventSchema, {
      title: action.title,
      start_time: start,
      end_time: end,
      location: action.location,
      event_type: "other",
    });
    return mutate(action.kind, "/api/events", "POST", body, key, sourceProof);
  }
  if (action.kind === "list_create")
    return mutate(
      action.kind,
      "/api/lists/create",
      "POST",
      validated(createListSchema, { name: action.title, type: action.type }),
      key,
      sourceProof,
    );
  if (action.kind === "note_create")
    return mutate(
      action.kind,
      "/api/notes",
      "POST",
      validated(createNoteSchema, {
        title: action.title,
        body: action.body,
        color: "yellow",
      }),
      key,
      sourceProof,
    );
  if (action.kind === "grocery_add") {
    let lists: unknown;
    try {
      // Discovery is a read-only preflight. A failure here cannot have
      // consumed the mutation key, so the reviewed action may be confirmed
      // deliberately again after the lists become available.
      const data = await request("/api/lists");
      lists = data.lists;
    } catch {
      throw new AssistantActionPreflightError("loadChoicesFailed");
    }
    const groceries = (lists as Array<{ id: string; type: string }>).filter(
      (l) => l.type === "grocery",
    );
    if (groceries.length !== 1)
      throw new AssistantActionPreflightError("chooseGroceryList");
    return mutate(
      action.kind,
      "/api/lists/items/create",
      "POST",
      { listId: groceries[0].id, content: action.title, quantity: 1 },
      key,
      sourceProof,
    );
  }
  throw new AssistantActionError("actionOpenSectionError");
}
