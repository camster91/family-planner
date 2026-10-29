/**
 * Native D1 assistant confirmation dispatcher.
 *
 * The browser submits a reviewed, canonical request body.  This module keeps
 * the assistant boundary deliberately thin: it validates that body, then
 * hands the effect to the same D1 domain kernels used by the ordinary API.
 * It never interprets an assistant proposal as authority and it never makes
 * an HTTP request back into the app.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  assistantConfirmationKind,
  type AssistantConfirmationKind,
} from "@/lib/assistant-reference-contract";
import type {
  AssistantProofActor,
  AssistantSourceGuard,
} from "@/lib/assistant-source-proof";
import type { DeleteTargetGuard } from "@/lib/assistant-delete-target";
import {
  createEventSchema,
  createChoreSchema,
  createListSchema,
  createListItemSchema,
  createNoteSchema,
  deleteEventSchema,
  deleteChoreSchema,
  deleteListSchema,
} from "@/lib/validations";
import { mutateD1Event, D1EventReceiptError } from "./event-mutations";
import { createD1Chore, D1ChoreCreateReceiptError } from "./chore-create";
import { deleteD1Chore, D1ChoreDeleteReceiptError } from "./chore-delete";
import { createD1List, createD1ListItem } from "./list-write";
import { deleteD1List } from "./list-delete";
import { D1PersonReceiptError, executeD1PersonEffect } from "./person-effect";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { canCreateList } from "@/lib/role-capabilities";
import type { EffectResult } from "@/lib/idempotency";
import type { D1Store } from "./database";

type ActionBody = Record<string, unknown>;

export type D1AssistantActionActor = AssistantProofActor & {
  name?: string;
};

export type D1AssistantActionCommand = {
  kind: AssistantConfirmationKind;
  body: ActionBody;
  profileRevision?: number;
};

export type D1AssistantActionResult = EffectResult & { replayed: boolean };

const invalid = (message: string): D1AssistantActionResult => ({
  status: 400,
  body: { error: message },
  replayed: false,
});

function parsed<T>(schema: z.ZodType<T>, body: ActionBody) {
  const result = schema.safeParse(body);
  return result.success ? result.data : null;
}

function deleteId(
  kind: Extract<
    AssistantConfirmationKind,
    "event_delete" | "chore_delete" | "list_delete"
  >,
  body: ActionBody,
) {
  const field =
    kind === "event_delete"
      ? "eventId"
      : kind === "chore_delete"
        ? "choreId"
        : "listId";
  const schema =
    kind === "event_delete"
      ? deleteEventSchema
      : kind === "chore_delete"
        ? deleteChoreSchema
        : deleteListSchema;
  const value = schema.safeParse(body);
  return value.success &&
    typeof value.data === "object" &&
    value.data !== null &&
    field in value.data
    ? (value.data as Record<string, string>)[field]
    : null;
}

/**
 * Execute one already-authenticated assistant confirmation on native D1.
 * Source and target guards are passed unchanged into the domain kernels so
 * their atomic snapshot checks remain the final authority immediately before
 * the write.
 */
export async function executeD1AssistantAction(
  actor: D1AssistantActionActor,
  command: D1AssistantActionCommand,
  key: string,
  options: {
    sourceGuard?: AssistantSourceGuard;
    targetGuard?: DeleteTargetGuard;
    database?: D1Store;
  } = {},
): Promise<D1AssistantActionResult> {
  const { kind, body } = command;
  if (!assistantConfirmationKind.safeParse(kind).success)
    return invalid("Unsupported confirmation");

  if (kind === "event_create") {
    const input = parsed(createEventSchema, body);
    if (!input) return invalid("Invalid event");
    if (typeof actor.name !== "string")
      return { status: 401, body: { error: "Unauthorized" }, replayed: false };
    return mutateD1Event(actor, { kind: "create", input }, key, {
      database: options.database,
      sourceGuard: options.sourceGuard,
    });
  }

  if (kind === "event_delete") {
    const eventId = deleteId(kind, body);
    if (!eventId) return invalid("eventId is required");
    return mutateD1Event(actor, { kind: "delete", eventId }, key, {
      database: options.database,
      sourceGuard: options.sourceGuard,
      targetGuard: options.targetGuard,
    });
  }

  if (kind === "chore_create") {
    if (body.protocol === 2 || body.selection !== undefined) {
      // Profile assignment is deliberately explicit. The profile kernel owns
      // member identity, revision and recurrence eligibility checks.
      const { profileChoreCreateSchema } =
        await import("@/lib/profile-chore-create-contract");
      const input = parsed(profileChoreCreateSchema, body);
      if (!input || command.profileRevision === undefined)
        return invalid("Profile assignment needs a current revision");
      return createD1Chore(
        actor,
        { kind: "profile", input, expectedRevision: command.profileRevision },
        key,
        {
          database: options.database,
          sourceGuard: options.sourceGuard,
          compact: true,
        },
      );
    }
    const input = parsed(createChoreSchema, body);
    if (!input) return invalid("Invalid chore");
    return createD1Chore(actor, { kind: "account", input }, key, {
      database: options.database,
      sourceGuard: options.sourceGuard,
    });
  }

  if (kind === "chore_delete") {
    const choreId = deleteId(kind, body);
    if (!choreId) return invalid("choreId is required");
    return deleteD1Chore(actor, choreId, key, {
      database: options.database,
      sourceGuard: options.sourceGuard,
      targetGuard: options.targetGuard,
    });
  }

  if (kind === "list_create") {
    const input = parsed(createListSchema, body);
    if (!input) return invalid("Invalid list");
    return createD1List(
      actor,
      input,
      key,
      options.sourceGuard,
      options.database,
    );
  }

  if (kind === "list_delete") {
    const listId = deleteId(kind, body);
    if (!listId) return invalid("listId is required");
    return deleteD1List(actor, listId, key, {
      database: options.database,
      sourceGuard: options.sourceGuard,
      targetGuard: options.targetGuard,
    });
  }

  if (kind === "grocery_add") {
    const input = parsed(createListItemSchema, body);
    if (!input) return invalid("Invalid grocery item");
    return createD1ListItem(
      actor,
      input,
      key,
      options.sourceGuard,
      options.database,
    );
  }

  // Notes are a first-class D1 effect too. Keep this implementation local to
  // the assistant dispatcher so the existing notes route can be migrated
  // independently without weakening its PostgreSQL recovery contract.
  if (kind === "note_create") {
    const input = parsed(createNoteSchema, body);
    if (!input) return invalid("Invalid note");
    return createD1AssistantNote(
      actor,
      input,
      key,
      options.sourceGuard,
      options.database,
    );
  }

  return invalid("Unsupported confirmation");
}

/** Capture's reviewed grocery add keeps default-list resolution, the item and
 * the keyed receipt in one native effect. This is intentionally separate from
 * the explicit-list assistant action above: capture is allowed to create the
 * household's first grocery list, while a reviewed assistant item must name
 * its list before it can be confirmed.
 */
export async function createD1CapturedGrocery(
  actor: D1AssistantActionActor,
  input: { content: string; quantity: number },
  key: string | null,
  database?: D1Store,
): Promise<D1AssistantActionResult> {
  return executeD1PersonEffect({
    actor,
    action: "capture.grocery.add",
    input,
    key,
    database,
    authorize: async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !user ||
        user.family_id !== actor.familyId ||
        user.role !== actor.role ||
        user.token_version !== actor.generation
      )
        return { status: 401, body: { error: "Unauthorized" } };
      if (!canCreateList(user.role))
        return {
          status: 403,
          body: { error: "This account cannot perform this list action" },
        };
      const family = await db.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      if (!family)
        return { status: 404, body: { error: "Household not found" } };
      if (!isFeatureEnabled(normalizeFeatures(family.features), "lists"))
        return {
          status: 403,
          body: { error: "This feature is turned off for your family" },
        };
      return null;
    },
    plan: async (db, receiptId) => {
      let list = null;
      for (const type of ["grocery", "shopping"] as const) {
        list = await db.list.findFirst({
          where: { family_id: actor.familyId, type },
          orderBy: [{ updated_at: "desc" }, { id: "asc" }],
          select: { id: true, name: true, type: true },
        });
        if (list) break;
      }
      const listCreated = !list;
      const listId = list?.id ?? randomUUID();
      const listName = list?.name ?? "Groceries";
      const listType = list?.type ?? "grocery";
      const max = await db.listItem.findFirst({
        where: { list_id: listId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      if (max && max.position >= 2147483647)
        return {
          status: 409,
          body: { error: "This list has reached its item position limit" },
        };
      const now = Date.now();
      const item = {
        id: randomUUID(),
        list_id: listId,
        content: input.content,
        checked: 0,
        quantity: input.quantity,
        price: null,
        purchased: 0,
        category: null,
        notes: null,
        added_by: actor.userId,
        checked_by: null,
        checked_at: null,
        position: (max?.position ?? 0) + 1,
        created_at: now,
        updated_at: now,
        ingredient_id: null,
        recipe_id: null,
        meal_id: null,
        amount: null,
        unit: null,
        source_request_id: receiptId,
      };
      return {
        status: 200,
        body: {
          success: true,
          item,
          list: { id: listId, name: listName, type: listType },
        },
        effects: (session) => [
          ...(listCreated
            ? [
                session
                  .prepare(
                    "INSERT INTO List(id,family_id,name,type,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)",
                  )
                  .bind(
                    listId,
                    actor.familyId,
                    listName,
                    listType,
                    actor.userId,
                    now,
                  ),
              ]
            : []),
          session
            .prepare(
              "INSERT INTO ListItem(id,list_id,content,quantity,category,notes,added_by,position,created_at,updated_at,ingredient_id,amount,unit,source_request_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?11,?12,?13)",
            )
            .bind(
              item.id,
              item.list_id,
              item.content,
              item.quantity,
              item.category,
              item.notes,
              item.added_by,
              item.position,
              now,
              item.ingredient_id,
              item.amount,
              item.unit,
              receiptId,
            ),
        ],
      };
    },
  });
}

async function createD1AssistantNote(
  actor: D1AssistantActionActor,
  input: z.infer<typeof createNoteSchema>,
  key: string,
  sourceGuard: AssistantSourceGuard | undefined,
  database: D1Store | undefined,
): Promise<D1AssistantActionResult> {
  if (
    input.expected_user_id !== undefined &&
    (input.expected_user_id !== actor.userId ||
      input.expected_family_id !== actor.familyId)
  )
    return {
      status: 409,
      body: { error: { code: "NOTE_OWNER_CHANGED", retryable: false } },
      replayed: false,
    };
  return executeD1PersonEffect({
    actor,
    action: "note.create",
    input,
    key,
    sourceGuard,
    database,
    authorize: async (db) => {
      const user = await db.user.findUnique({
        where: { id: actor.userId },
        select: { family_id: true, role: true, token_version: true },
      });
      if (
        !user ||
        user.family_id !== actor.familyId ||
        user.role !== actor.role ||
        user.token_version !== actor.generation
      )
        return { status: 401, body: { error: "Unauthorized" } };
      if (user.role !== "parent" && user.role !== "teen")
        return { status: 403, body: { error: "Ask a parent to use notes." } };
      const family = await db.family.findUnique({
        where: { id: actor.familyId },
        select: { features: true },
      });
      if (!family)
        return { status: 404, body: { error: "Household not found" } };
      if (!isFeatureEnabled(normalizeFeatures(family.features), "notes"))
        return {
          status: 403,
          body: { error: "This feature is turned off for your family" },
        };
      return null;
    },
    plan: async (_db) => {
      const now = Date.now();
      const note = {
        id: randomUUID(),
        family_id: actor.familyId,
        title: input.title,
        body: (input.body || "").trim(),
        color:
          typeof input.color === "string" &&
          ["yellow", "pink", "blue", "green", "purple"].includes(input.color)
            ? input.color
            : "yellow",
        pinned: 1,
        created_by: actor.userId,
        created_at: now,
        updated_at: now,
      };
      return {
        status: 201,
        body: { note },
        effects: (session) => [
          session
            .prepare(
              'INSERT INTO "PinnedNote"(id,family_id,title,body,color,pinned,created_by,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)',
            )
            .bind(
              note.id,
              note.family_id,
              note.title,
              note.body,
              note.color,
              note.pinned,
              note.created_by,
              note.created_at,
            ),
        ],
      };
    },
  });
}

/** Convert native receipt errors to the same retryable API contract as the
 * canonical routes. The caller decides the response type and headers. */
export function d1AssistantIdempotencyError(
  error: unknown,
): EffectResult | null {
  const code =
    error instanceof D1EventReceiptError ||
    error instanceof D1ChoreCreateReceiptError ||
    error instanceof D1ChoreDeleteReceiptError ||
    error instanceof D1PersonReceiptError
      ? error.code
      : null;
  if (!code) return null;
  const retryable = code === "IDEMPOTENCY_IN_PROGRESS";
  return {
    status: code === "IDEMPOTENCY_KEY_REUSED" ? 422 : 409,
    body: {
      error: {
        code,
        message: retryable
          ? "The original request is still being processed."
          : "This request key was already used for a different request.",
        retryable,
      },
    },
  };
}
