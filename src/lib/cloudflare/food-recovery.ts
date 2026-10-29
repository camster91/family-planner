/** Native D1 adapters for food recovery, selectors and grocery child receipts.
 *
 * These are deliberately read/receipt-first. A recovery request never retries
 * a new food plan; grocery undo validates the linked child receipt before
 * removing only this actor's still-unchecked rows.
 */
import { hashIdempotentRequest } from "../idempotency-hash";
import { IDEMPOTENCY_LOCK_TIMEOUT_MS } from "../idempotency-key";
import { isFeatureEnabled, normalizeFeatures } from "../features";
import { parseCalendarInstant } from "../calendar-planning/instant";
import type { FoodPlanActor } from "../food-planning/server";
import {
  FOOD_APPLY_ACTION,
  reviewedFoodWrite,
  foodApplyReceipt,
  foodApplyReceiptMatches,
  type ReviewedFoodWrite,
} from "../food-planning/apply-contract";
import {
  FOOD_RECOVERY,
  foodRecoveryContext,
  foodRecoveryReply,
  type FoodRecoveryEntry,
} from "../food-planning/recovery-contract";
import {
  FOOD_GROCERY_OUTCOMES,
  canonicalGroceryResult,
  foodGroceryOutcomesReply,
  foodGroceryUndoReply,
} from "../food-planning/grocery-outcomes-contract";
import {
  FOOD_OPTIONS,
  FOOD_OPTIONS_PAGE,
  foodOptionsQuery,
  foodOptionsReply,
  type FoodOptionsQuery,
  type FoodOption,
} from "../food-planning/options-contract";
import {
  addFromRecipeSchema,
  ADD_FROM_RECIPE_ACTION,
  UNDO_WINDOW_MS,
} from "../grocery-from-recipe-contract";
import {
  FoodReviewRefused,
  foodReviewDigest,
  readFoodReviewSeal,
} from "../food-planning/review-proof";
import { foodWriteChoicesMatch } from "../food-planning/choices";
import {
  D1FoodPlanningUnavailable,
  previewD1FoodPlan,
  readD1FoodReviewAuxiliary,
} from "./food-planning";
import { d1WriteCheck } from "./write-check";
import type { D1Store } from "./database";
import { captureD1Reads } from "./read-witness";
import { authorizeD1Lists } from "./list-authority";
import { d1FoodSourceStorageAvailable } from "./food-source-versions";
import { isAiUsageReady } from "../ai-usage-gates";

// Keep native recovery importable by a Worker fixture without pulling the
// request/owner HTTP wrapper (or Next's server runtime) into the D1 kernel.
const foodWritingReady = () =>
  process.env.FAMILY_FOOD_PLANNING_READY === "1" &&
  process.env.QUEUE_OWNER_RECOVERY_ENABLED === "1" &&
  process.env.QUEUE_OWNER_RECOVERY_ROLLBACK_READY === "1";
const foodAiReady = () =>
  process.env.FAMILY_FOOD_AI_READY === "1" &&
  process.env.FAMILY_FOOD_PLANNING_READY === "1" &&
  isAiUsageReady() &&
  process.env.FAMILY_AI_PROVIDER_DISABLED !== "1";

const session = (db: D1Store) => db.withSession("first-primary");
const parseStored = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const placeholders = (count: number, start = 2) =>
  Array.from({ length: count }, (_, index) => `?${index + start}`).join(",");
export class D1FoodGroceryUnavailable extends Error {
  readonly code = "GROCERY_DETAILS_UNAVAILABLE" as const;
  constructor() {
    super("Grocery details are unavailable");
  }
}
function unavailable(): never {
  throw new D1FoodGroceryUnavailable();
}

export async function readD1FoodRecoveryContext(
  db: D1Store,
  actor: FoodPlanActor,
  owner: unknown,
) {
  const row = await session(db)
    .prepare(
      `SELECT u.email_verified,f.features FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1 AND u.family_id=?2 AND u.role=?3`,
    )
    .bind(actor.userId, actor.familyId, actor.role)
    .first<{ email_verified: number | boolean; features: unknown }>();
  const features = normalizeFeatures(parseStored(row?.features));
  const sourceAvailable = await d1FoodSourceStorageAvailable(db);
  return foodRecoveryContext.parse({
    contract: FOOD_RECOVERY,
    enabled:
      owner !== null &&
      isFeatureEnabled(features, "inventory") &&
      foodWritingReady() &&
      sourceAvailable,
    owner,
    canPrep: Boolean(row?.email_verified),
    canAskAi: foodAiReady(),
    userId: actor.userId,
    familyId: actor.familyId,
    role: actor.role,
  });
}

export async function readD1FoodOptions(
  db: D1Store,
  actor: FoodPlanActor,
  raw: FoodOptionsQuery,
) {
  const query = foodOptionsQuery.parse(raw);
  const family = await session(db)
    .prepare(`SELECT features FROM "Family" WHERE id=?1`)
    .bind(actor.familyId)
    .first<{ features: unknown }>();
  if (
    process.env.FAMILY_FOOD_PLANNING_READY !== "1" ||
    !family ||
    !isFeatureEnabled(normalizeFeatures(parseStored(family.features)), "meals")
  )
    throw new D1FoodPlanningUnavailable();

  const search = query.search ? `%${query.search.toLowerCase()}%` : null;
  const selected = query.selectedIds;
  const read = session(db);
  let rows: Array<Record<string, unknown>> = [];
  if (
    query.kind === "recipes" ||
    query.kind === "people" ||
    query.kind === "lists"
  ) {
    const selectedSql = selected.length
      ? ` AND id IN (${placeholders(selected.length)})`
      : "";
    const pageArgs: Array<string | number | null> = [
      actor.familyId,
      ...(selected.length ? selected : []),
    ];
    if (query.kind === "recipes") {
      rows = (
        await read
          .prepare(
            `SELECT id,title,servings,prep_time,cook_time FROM "Recipe" WHERE family_id=?1${selectedSql}${search && !selected.length ? ` AND lower(title) LIKE ?${selected.length + 2}` : ""} ORDER BY title,id LIMIT ?${selected.length + (search && !selected.length ? 3 : 2)} OFFSET ?${selected.length + (search && !selected.length ? 4 : 3)}`,
          )
          .bind(
            ...pageArgs,
            ...(search && !selected.length ? [search] : []),
            selected.length ? 50 : FOOD_OPTIONS_PAGE + 1,
            selected.length ? 0 : query.offset,
          )
          .all()
      ).results as Array<Record<string, unknown>>;
    } else if (query.kind === "people") {
      rows = (
        await read
          .prepare(
            `SELECT id,name,role FROM "User" WHERE family_id=?1${selectedSql}${search && !selected.length ? ` AND lower(name) LIKE ?${selected.length + 2}` : ""} ORDER BY name,id LIMIT ?${selected.length + (search && !selected.length ? 3 : 2)} OFFSET ?${selected.length + (search && !selected.length ? 4 : 3)}`,
          )
          .bind(
            ...pageArgs,
            ...(search && !selected.length ? [search] : []),
            selected.length ? 50 : FOOD_OPTIONS_PAGE + 1,
            selected.length ? 0 : query.offset,
          )
          .all()
      ).results as Array<Record<string, unknown>>;
    } else {
      rows = (
        await read
          .prepare(
            `SELECT id,name,type FROM "List" WHERE family_id=?1 AND type IN ('grocery','shopping')${selectedSql}${search && !selected.length ? ` AND lower(name) LIKE ?${selected.length + 2}` : ""} ORDER BY name,id LIMIT ?${selected.length + (search && !selected.length ? 3 : 2)} OFFSET ?${selected.length + (search && !selected.length ? 4 : 3)}`,
          )
          .bind(
            ...pageArgs,
            ...(search && !selected.length ? [search] : []),
            selected.length ? 50 : FOOD_OPTIONS_PAGE + 1,
            selected.length ? 0 : query.offset,
          )
          .all()
      ).results as Array<Record<string, unknown>>;
    }
  } else {
    const start = +parseCalendarInstant(query.range!.start);
    const end = +parseCalendarInstant(query.range!.end);
    const selectedSql = selected.length
      ? ` AND id IN (${placeholders(selected.length)})`
      : "";
    rows = (
      await read
        .prepare(
          `SELECT id,title,start_time,end_time,recurrence FROM "Event" WHERE family_id=?1${selected.length ? selectedSql : " AND start_time>=?2 AND start_time<?3"}${query.search && !selected.length ? ` AND lower(title) LIKE ?4` : ""} ORDER BY start_time,id LIMIT ?${selected.length ? selected.length + 2 : query.search ? 5 : 4} OFFSET ?${selected.length ? selected.length + 3 : query.search ? 6 : 5}`,
        )
        .bind(
          actor.familyId,
          ...(selected.length ? selected : [start, end]),
          ...(query.search && !selected.length ? [search] : []),
          selected.length ? 50 : FOOD_OPTIONS_PAGE + 1,
          selected.length ? 0 : query.offset,
        )
        .all()
    ).results as Array<Record<string, unknown>>;
  }

  const kind = query.kind;
  const map = (row: Record<string, unknown>): FoodOption => {
    if (kind === "recipes")
      return {
        kind: "recipe",
        id: String(row.id),
        title: String(row.title),
        servings: Number(row.servings),
        minutes:
          row.prep_time === null || row.cook_time === null
            ? null
            : Number(row.prep_time) + Number(row.cook_time),
      };
    if (kind === "people")
      return {
        kind: "person",
        id: String(row.id),
        name: String(row.name),
        role: String(row.role),
      };
    if (kind === "lists")
      return {
        kind: "list",
        id: String(row.id),
        name: String(row.name),
        type: row.type as "grocery" | "shopping",
      };
    return {
      kind: "departure",
      id: String(row.id),
      title: String(row.title ?? ""),
      start: new Date(Number(row.start_time)).toISOString(),
      end: new Date(Number(row.end_time)).toISOString(),
      repeating: row.recurrence !== null,
    };
  };
  const all = rows.map(map);
  const selectedItems = selected.length
    ? all.filter((item) => selected.includes(item.id))
    : [];
  if (selectedItems.length !== selected.length) unavailable();
  return foodOptionsReply.parse({
    protocol: FOOD_OPTIONS,
    owner: actor,
    query,
    items: all.slice(0, FOOD_OPTIONS_PAGE),
    selected: selectedItems,
    hasMore: all.length > FOOD_OPTIONS_PAGE,
  });
}

type FoodRoot = {
  command: ReviewedFoodWrite;
  receipt: ReturnType<typeof foodApplyReceipt.parse>;
  requestHash: string;
  createdAt: number;
};

async function readFoodRoot(
  db: D1Store,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
): Promise<FoodRoot> {
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  // The root receipt is private owner-bound state; preserve the same review
  // proof check as the PostgreSQL recovery path before exposing child pointers.
  readFoodReviewSeal(actor, command);
  const family = await session(db)
    .prepare(`SELECT features FROM "Family" WHERE id=?1`)
    .bind(actor.familyId)
    .first<{ features: unknown }>();
  if (
    !family ||
    !isFeatureEnabled(normalizeFeatures(parseStored(family.features)), "lists")
  )
    unavailable();
  const requestHash = hashIdempotentRequest(FOOD_APPLY_ACTION, command);
  const row = await session(db)
    .prepare(
      `SELECT user_id,family_id,action,request_hash,response_status,response_body,created_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`,
    )
    .bind(`user:${actor.userId}`, entry.key)
    .first<{
      user_id: string;
      family_id: string;
      action: string;
      request_hash: string;
      response_status: number | null;
      response_body: unknown;
      created_at: number;
    }>();
  if (!row) unavailable();
  if (
    row.user_id !== actor.userId ||
    row.family_id !== actor.familyId ||
    row.action !== FOOD_APPLY_ACTION ||
    row.request_hash !== requestHash ||
    row.response_status !== 201
  )
    unavailable();
  const receipt = foodApplyReceipt.safeParse(parseStored(row.response_body));
  if (!receipt.success) unavailable();
  const parsedReceipt = receipt.data;
  if (!foodApplyReceiptMatches(parsedReceipt, command)) unavailable();
  return {
    command,
    receipt: parsedReceipt,
    requestHash,
    createdAt: row.created_at,
  };
}

function childInput(
  source: FoodRoot,
  pointer: FoodRoot["receipt"]["groceries"][number],
) {
  const selection = source.command.groceries.find(
    (row) => row.key === pointer.key,
  );
  if (!selection) return null;
  if (source.command.mode === "meals") {
    const meal = source.command.meals.find((row) => row.key === pointer.key);
    const target = source.receipt.meals.find((row) => row.key === pointer.key);
    if (!meal || !target) return null;
    return addFromRecipeSchema.parse({
      recipeId: meal.input.recipe_id!,
      mealId: target.mealId,
      servings: meal.input.servings ?? undefined,
      listId: selection.listId,
      ingredientIds: selection.ingredientIds,
    });
  }
  const index = source.command.dishKeys.indexOf(pointer.key);
  const dish = source.command.input.dishes[index];
  const target = source.receipt.prep?.dishes.find(
    (row) => row.key === pointer.key,
  );
  if (!dish || !target) return null;
  return addFromRecipeSchema.parse({
    recipeId: dish.recipe_id!,
    batchId: target.batchId,
    servings: dish.total_servings,
    listId: selection.listId,
    ingredientIds: selection.ingredientIds,
  });
}

async function readChild(
  db: D1Store,
  actor: FoodPlanActor,
  source: FoodRoot,
  pointer: FoodRoot["receipt"]["groceries"][number],
) {
  const input = childInput(source, pointer);
  if (!input) return null;
  const row = await session(db)
    .prepare(
      `SELECT response_status,response_body,created_at FROM "IdempotencyRecord" WHERE id=?1 AND scope=?2 AND user_id=?3 AND family_id=?4 AND action=?5 AND request_hash=?6`,
    )
    .bind(
      pointer.requestId,
      `user:${actor.userId}`,
      actor.userId,
      actor.familyId,
      ADD_FROM_RECIPE_ACTION,
      hashIdempotentRequest(ADD_FROM_RECIPE_ACTION, input),
    )
    .first<{
      response_status: number | null;
      response_body: unknown;
      created_at: number;
    }>();
  if (!row || row.response_status !== 201) return null;
  const parsed = canonicalGroceryResult.safeParse(
    parseStored(row.response_body),
  );
  if (!parsed.success) return null;
  const result = parsed.data;
  const selection = source.command.groceries.find(
    (item) => item.key === pointer.key,
  );
  return selection &&
    result.requestId === pointer.requestId &&
    result.listId === pointer.listId &&
    result.createdCount + result.alreadyOnListCount ===
      selection.ingredientIds.length &&
    Date.parse(result.undoExpiresAt) === row.created_at + UNDO_WINDOW_MS &&
    result.possibleDuplicates.every((item) =>
      selection.ingredientIds.includes(item.ingredientId),
    )
    ? result
    : null;
}

export async function readD1FoodGroceryOutcomes(
  db: D1Store,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
  ownerScope: string,
) {
  const source = await readFoodRoot(db, actor, entry);
  const outcomes = [];
  for (const pointer of source.receipt.groceries)
    outcomes.push({
      ...pointer,
      result: await readChild(db, actor, source, pointer),
    });
  return foodGroceryOutcomesReply.parse({
    protocol: FOOD_GROCERY_OUTCOMES,
    ownerScope,
    requestHash: source.requestHash,
    outcomes,
  });
}

export async function undoD1FoodGroceryAdd(
  db: D1Store,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
  requestId: string,
  ownerScope: string,
) {
  const source = await readFoodRoot(db, actor, entry);
  const pointer = source.receipt.groceries.find(
    (row) => row.requestId === requestId,
  );
  if (!pointer || !(await readChild(db, actor, source, pointer))) unavailable();
  const now = new Date();
  const captured = await captureD1Reads(
    async (readDb) => {
      const denied = await authorizeD1Lists(readDb, actor);
      if (denied) return { kind: "reply" as const, reply: denied };
      const record = await readDb.idempotencyRecord.findFirst({
        where: {
          id: requestId,
          family_id: actor.familyId,
          action: ADD_FROM_RECIPE_ACTION,
        },
        select: { user_id: true, created_at: true, response_status: true },
      });
      if (!record)
        return {
          kind: "reply" as const,
          reply: {
            status: 404,
            body: {
              error: {
                code: "UNDO_NOT_FOUND",
                message: "There is nothing to undo.",
                retryable: false,
              },
            },
          },
        };
      if (record.user_id !== actor.userId)
        return {
          kind: "reply" as const,
          reply: {
            status: 403,
            body: {
              error: {
                code: "UNDO_NOT_ALLOWED",
                message: "Only the person who added these items can undo it.",
                retryable: false,
              },
            },
          },
        };
      if (record.response_status == null)
        return {
          kind: "reply" as const,
          reply: {
            status: 409,
            body: {
              error: {
                code: "UNDO_IN_PROGRESS",
                message: "The add is still being saved. Try again in a moment.",
                retryable: true,
              },
            },
          },
        };
      const cutoff = now.getTime() - UNDO_WINDOW_MS;
      if (record.created_at.getTime() < cutoff)
        return {
          kind: "reply" as const,
          reply: {
            status: 409,
            body: {
              error: {
                code: "UNDO_WINDOW_EXPIRED",
                message:
                  "It is too late to undo this. Remove the items from the list instead.",
                retryable: false,
              },
            },
          },
        };
      return {
        kind: "plan" as const,
        cutoff,
        createdAt: record.created_at.getTime(),
      };
    },
    db as unknown as import("./read-client").NativeD1,
  );
  let undone: { status: number; body: unknown };
  if (captured.value.kind === "reply") {
    await db
      .withSession("first-primary")
      .batch(captured.checks(db.withSession("first-primary")));
    undone = captured.value.reply;
  } else {
    const sql = db.withSession("first-primary");
    const result = await sql.batch([
      ...captured.checks(sql),
      d1WriteCheck(
        sql,
        "EXISTS (SELECT 1 FROM IdempotencyRecord WHERE id=?1 AND family_id=?2 AND user_id=?3 AND action=?4 AND response_status IS NOT NULL AND created_at=?5)",
        [
          requestId,
          actor.familyId,
          actor.userId,
          ADD_FROM_RECIPE_ACTION,
          captured.value.createdAt,
        ],
      ),
      sql
        .prepare(
          "DELETE FROM ListItem WHERE source_request_id=?1 AND added_by=?2 AND checked=0 AND created_at>=?3 AND list_id IN (SELECT id FROM List WHERE family_id=?4)",
        )
        .bind(requestId, actor.userId, captured.value.cutoff, actor.familyId),
      sql
        .prepare(
          "SELECT COUNT(*) AS total FROM ListItem WHERE source_request_id=?1 AND added_by=?2 AND checked=1 AND list_id IN (SELECT id FROM List WHERE family_id=?3)",
        )
        .bind(requestId, actor.userId, actor.familyId),
    ]);
    undone = {
      status: 200,
      body: {
        requestId,
        removedCount: Number(result.at(-2)?.meta?.changes ?? 0),
        keptCheckedCount: Number(
          (result.at(-1)?.results?.[0] as { total?: number } | undefined)
            ?.total ?? 0,
        ),
      },
    };
  }
  const result =
    "error" in (undone.body as Record<string, unknown>)
      ? {
          kind: "refused" as const,
          code: (undone.body as { error: { code: string } }).error.code as
            | "UNDO_NOT_FOUND"
            | "UNDO_NOT_ALLOWED"
            | "UNDO_WINDOW_EXPIRED"
            | "UNDO_IN_PROGRESS",
        }
      : {
          kind: "done" as const,
          removedCount: Number(
            (undone.body as { removedCount: number }).removedCount,
          ),
          keptCheckedCount: Number(
            (undone.body as { keptCheckedCount: number }).keptCheckedCount,
          ),
        };
  return foodGroceryUndoReply.parse({
    protocol: FOOD_GROCERY_OUTCOMES,
    ownerScope,
    requestHash: source.requestHash,
    requestId,
    result,
  });
}

export async function inspectD1FoodRequest(
  db: D1Store,
  actor: FoodPlanActor,
  entry: FoodRecoveryEntry,
  ownerScope: string,
  now = new Date(),
) {
  const command = reviewedFoodWrite.parse(JSON.parse(entry.body));
  const seal = readFoodReviewSeal(actor, command);
  const requestHash = hashIdempotentRequest(FOOD_APPLY_ACTION, command);
  const reply = (
    state: ReturnType<typeof foodRecoveryReply.parse>["state"],
    receipt: unknown = null,
  ) =>
    foodRecoveryReply.parse({
      contract: FOOD_RECOVERY,
      ownerScope,
      entry,
      requestHash,
      state,
      canRetry: state === "ready",
      retryUntil: state === "ready" ? seal.expiresAt : null,
      receipt,
    });
  const row = await session(db)
    .prepare(
      `SELECT user_id,family_id,action,request_hash,response_status,response_body,created_at,expires_at FROM "IdempotencyRecord" WHERE scope=?1 AND key=?2`,
    )
    .bind(`user:${actor.userId}`, entry.key)
    .first<{
      user_id: string;
      family_id: string;
      action: string;
      request_hash: string;
      response_status: number | null;
      response_body: unknown;
      created_at: number;
      expires_at: number;
    }>();
  if (
    row &&
    (row.user_id !== actor.userId ||
      row.family_id !== actor.familyId ||
      row.action !== FOOD_APPLY_ACTION ||
      row.request_hash !== requestHash)
  )
    return reply("conflict");
  if (row?.response_status !== null && row?.response_status !== undefined) {
    const receipt = foodApplyReceipt.safeParse(parseStored(row.response_body));
    return receipt.success &&
      row.response_status === 201 &&
      foodApplyReceiptMatches(receipt.data, command)
      ? reply("committed", receipt.data)
      : reply("unavailable");
  }
  if (
    now.getTime() >= Date.parse(seal.expiresAt) ||
    (row && row.expires_at <= now.getTime())
  )
    return reply("expired");
  if (now.getTime() < Date.parse(seal.issuedAt) - 1000)
    return reply("unavailable");
  if (!foodWritingReady()) return reply("paused");
  if (row && row.created_at > now.getTime() - IDEMPOTENCY_LOCK_TIMEOUT_MS)
    return reply("pending");
  try {
    const observation = await previewD1FoodPlan(
      db,
      actor,
      command.sourceRequest,
      now,
    );
    if (
      observation.snapshotRevision !== seal.source ||
      !foodWriteChoicesMatch(actor, command, observation.plan)
    )
      return reply("conflict");
    const auxiliary = await readD1FoodReviewAuxiliary(db, actor, command, now);
    if (
      foodReviewDigest("food-review.auxiliary.v1", auxiliary) !== seal.auxiliary
    )
      return reply("conflict");
    return reply("ready");
  } catch (error) {
    return reply(
      error instanceof FoodReviewRefused ? "conflict" : "unavailable",
    );
  }
}

export async function d1FoodPlanningStorageAvailable(db: D1Store) {
  return d1FoodSourceStorageAvailable(db);
}
