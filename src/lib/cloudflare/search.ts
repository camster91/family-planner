import type { EffectResult } from "@/lib/idempotency";
import { normalizeFeatures } from "@/lib/features";
import {
  escapeLikePattern,
  searchableTypes,
  SEARCH_MAX_RESULTS,
  SEARCH_PER_TYPE,
  type SearchResult,
} from "@/lib/household-search";
import {
  searchResultHref,
  type SearchHrefTarget,
  type SearchResultType,
} from "@/lib/search-result-href";
import { getD1Database, type D1Store } from "./database";

export type D1SearchActor = {
  userId: string;
  familyId: string;
  role: string;
  generation: number;
};

type AuthorityRow = {
  family_id: string | null;
  role: string;
  token_version: number;
  features: string | null;
};

type SearchRow = {
  id: string;
  title: string;
  subtitle?: string;
  date?: Date;
  target: SearchHrefTarget;
};

const ROLE_LABEL: Record<string, string> = {
  parent: "Parent",
  teen: "Teen",
  child: "Child",
};
const CHORE_STATUS_LABEL: Record<string, string> = {
  pending: "To do",
  in_progress: "In progress",
  completed: "Waiting for a parent's check",
  verified: "Done",
  overdue: "Overdue",
};
const LIST_TYPE_LABEL: Record<string, string> = {
  grocery: "Shopping list",
  shopping: "Shopping list",
  todo: "To-do list",
  meal_plan: "Meal plan list",
  wishlist: "Wish list",
};
const LOCATION_LABEL: Record<string, string> = {
  fridge: "Fridge",
  freezer: "Freezer",
  pantry: "Pantry",
};

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function timestamp(value: unknown): Date | undefined {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value : undefined;
  const date = new Date(Number(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function searchPattern(query: string) {
  return `%${escapeLikePattern(query.toLowerCase())}%`;
}

function asResult(
  type: SearchResultType,
  row: SearchRow,
  role: string,
): SearchResult | null {
  const href = searchResultHref(role, row.target);
  if (!href) return null;
  return {
    type,
    id: row.id,
    title: row.title,
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    href,
    ...(row.date ? { date: row.date.toISOString() } : {}),
  };
}

function groupRows(
  type: SearchResultType,
  rows: SearchRow[],
  role: string,
): SearchResult[] {
  return rows
    .map((row) => asResult(type, row, role))
    .filter((row): row is SearchResult => row !== null);
}

/**
 * Native counterpart of `searchHousehold`.
 *
 * Search is intentionally a read-only, bounded set of direct D1 projections:
 * every query binds the household and literal LIKE pattern, and each type is
 * capped before the fixed result order is assembled. Authority is checked in
 * the same D1 session before any domain rows are returned.
 */
export async function readD1HouseholdSearch(
  actor: D1SearchActor,
  query: string,
  database?: D1Store,
): Promise<EffectResult> {
  const store = database ?? (await getD1Database());
  const db = store.withSession("first-primary");
  const authority = await db
    .prepare(
      `SELECT u.family_id,u.role,u.token_version,f.features
    FROM "User" u LEFT JOIN "Family" f ON f.id=?2
    WHERE u.id=?1`,
    )
    .bind(actor.userId, actor.familyId)
    .first<AuthorityRow>();
  if (
    !authority ||
    authority.family_id !== actor.familyId ||
    authority.role !== actor.role ||
    authority.token_version !== actor.generation
  )
    return { status: 401, body: { error: "Unauthorized" } };

  const types = searchableTypes(
    actor.role,
    normalizeFeatures(jsonValue(authority.features)),
  );
  const pattern = searchPattern(query);

  const load = async (type: SearchResultType): Promise<SearchRow[]> => {
    switch (type) {
      case "member": {
        const result = await db
          .prepare(
            `SELECT id,name,role
          FROM "User"
          WHERE family_id=?1 AND lower(name) LIKE ?2 ESCAPE '\\'
          ORDER BY name ASC,id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{ id: string; name: string; role: string }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: ROLE_LABEL[row.role],
          target: { type: "member" } as const,
        }));
      }
      case "event": {
        const result = await db
          .prepare(
            `SELECT id,title,start_time,location
          FROM "Event"
          WHERE family_id=?1 AND (lower(title) LIKE ?2 ESCAPE '\\'
            OR lower(COALESCE(description,'')) LIKE ?2 ESCAPE '\\'
            OR lower(COALESCE(location,'')) LIKE ?2 ESCAPE '\\')
          ORDER BY start_time DESC,id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{
            id: string;
            title: string;
            start_time: number;
            location: string | null;
          }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.location || undefined,
          date: timestamp(row.start_time),
          target: {
            type: "event",
            start: timestamp(row.start_time) ?? new Date(0),
          } as const,
        }));
      }
      case "chore": {
        const result = await db
          .prepare(
            `SELECT c.id,c.title,c.status,c.due_date,u.name AS assignee_name
          FROM "Chore" c LEFT JOIN "User" u ON u.id=c.assigned_to AND u.family_id=c.family_id
          WHERE c.family_id=?1 AND (lower(c.title) LIKE ?2 ESCAPE '\\'
            OR lower(COALESCE(c.description,'')) LIKE ?2 ESCAPE '\\')
          ORDER BY c.due_date DESC,c.id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{
            id: string;
            title: string;
            status: string;
            due_date: number;
            assignee_name: string | null;
          }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle:
            [
              row.assignee_name ? `For ${row.assignee_name}` : null,
              CHORE_STATUS_LABEL[row.status],
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          date: timestamp(row.due_date),
          target: { type: "chore" } as const,
        }));
      }
      case "list": {
        const result = await db
          .prepare(
            `SELECT id,name,type
          FROM "List"
          WHERE family_id=?1 AND (lower(name) LIKE ?2 ESCAPE '\\'
            OR lower(COALESCE(description,'')) LIKE ?2 ESCAPE '\\')
          ORDER BY name ASC,id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{ id: string; name: string; type: string }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: LIST_TYPE_LABEL[row.type] ?? "List",
          target: { type: "list", id: row.id } as const,
        }));
      }
      case "list_item": {
        const result = await db
          .prepare(
            `SELECT i.id,i.content,i.checked,l.id AS list_id,l.name AS list_name
          FROM "ListItem" i JOIN "List" l ON l.id=i.list_id
          WHERE l.family_id=?1 AND lower(i.content) LIKE ?2 ESCAPE '\\'
          ORDER BY i.checked ASC,i.content ASC,i.id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{
            id: string;
            content: string;
            checked: number;
            list_id: string;
            list_name: string;
          }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.content,
          subtitle: `On ${row.list_name}${Number(row.checked) === 1 ? " · ticked" : ""}`,
          target: { type: "list_item", listId: row.list_id } as const,
        }));
      }
      case "recipe": {
        const result = await db
          .prepare(
            `SELECT id,title,prep_time
          FROM "Recipe"
          WHERE family_id=?1 AND (lower(title) LIKE ?2 ESCAPE '\\'
            OR lower(COALESCE(description,'')) LIKE ?2 ESCAPE '\\')
          ORDER BY title ASC,id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{ id: string; title: string; prep_time: number | null }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: row.prep_time
            ? `${row.prep_time} min to prepare`
            : undefined,
          target: { type: "recipe", id: row.id } as const,
        }));
      }
      case "note": {
        const result = await db
          .prepare(
            `SELECT id,title
          FROM "PinnedNote"
          WHERE family_id=?1 AND (lower(title) LIKE ?2 ESCAPE '\\'
            OR lower(body) LIKE ?2 ESCAPE '\\')
          ORDER BY created_at DESC,id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{ id: string; title: string }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.title,
          subtitle: "Note",
          target: { type: "note" } as const,
        }));
      }
      case "inventory": {
        const result = await db
          .prepare(
            `SELECT id,name,location
          FROM "InventoryItem"
          WHERE family_id=?1 AND status='active' AND lower(name) LIKE ?2 ESCAPE '\\'
          ORDER BY name ASC,id ASC LIMIT ${SEARCH_PER_TYPE}`,
          )
          .bind(actor.familyId, pattern)
          .all<{ id: string; name: string; location: string }>();
        return result.results.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: `In the ${(LOCATION_LABEL[row.location] ?? "Fridge").toLowerCase()}`,
          target: { type: "inventory" } as const,
        }));
      }
    }
  };

  const groups = await Promise.all(
    types.map(async (type) => groupRows(type, await load(type), actor.role)),
  );
  const results = groups.flat().slice(0, SEARCH_MAX_RESULTS);
  return { status: 200, body: { results } };
}
