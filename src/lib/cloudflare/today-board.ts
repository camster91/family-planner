import { getD1Database, type D1Store, type SqlValue } from "./database";
import {
  hiddenD1RoutineOccurrenceIds,
  scheduledOnceD1RoutineOccurrenceIds,
} from "./chore-read-policy";
import { normalizeFeatures, isFeatureEnabled } from "@/lib/features";
import { canRoleAccessPath } from "@/lib/kid-access";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
  type MemberProtocol,
} from "@/lib/member-subject-contract";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/profile-chore-gates";
import { isRoutineIconKey } from "@/lib/routine-icons";
import { addUTCDays, startOfTodayUTC, toDateOnlyUTC } from "@/lib/dates";
import { COMING_UP_DAYS } from "@/lib/board-constants";
import { resolveMemberColors } from "@/lib/member-colors";
import {
  MAX_AMBIENT_PHOTOS,
  idleMinutesFrom,
  nightHoursFrom,
  type BoardDisplay,
} from "@/lib/ambient";
import { CHORE_PHOTO_FILENAME_RE, chorePhotoPath } from "@/lib/chore-photos";
import {
  DEFAULT_USE_SOON_DAYS,
  asDateKind,
  asLocation,
  countMissingIngredients,
  type CookInventoryInput,
  type DateKind,
  type InventoryLocation,
} from "@/lib/inventory";
import { eventPreparationReady } from "@/lib/event-preparation/owner";
import type {
  BoardChore,
  BoardDinner,
  BoardEvent,
  BoardLinks,
  BoardMember,
  BoardPhoto,
  BoardSubject,
  BoardUseSoonItem,
  TodayBoardData,
} from "@/app/dashboard/today/today-board-data";
import {
  isWeatherEnabled,
  type BoardWeather,
} from "@/lib/weather/board-weather";
import { getD1BoardWeather } from "./today-board-weather";

const MAX_EVENTS = 60;
const MAX_CHORES = 80;
const MAX_USE_SOON = 50;
const BOARD_DINNER_INGREDIENT_MAX = 200;

type Row = Record<string, unknown>;
type D1Session = Pick<D1Store, "prepare" | "batch">;
type D1TodayBoardOptions = {
  familyId: string;
  now?: Date;
  memberProtocol?: MemberProtocol;
  withWeather?: boolean;
} & (
  | { audience?: "person"; role: string | null | undefined }
  | { audience: "device"; role?: never }
);

export type D1TodayBoardResult = {
  data: TodayBoardData;
  /** Settings used by boardVersion; never serialized. */
  weatherKey: unknown;
};

const NO_LINKS: BoardLinks = {
  calendar: null,
  chores: null,
  meals: null,
  lists: null,
  features: null,
  inventory: null,
};
const DISPLAYABLE_PHOTO_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
function profileProtocolRefusal() {
  return {
    code: "MEMBER_PROTOCOL_UNAVAILABLE" as const,
    recovery: "refresh-and-retain-pending" as const,
    requiredProtocol: 2 as const,
    receivedProtocol: 1 as const,
  };
}
function profileAction(
  row: {
    assigned_member_id: string | null;
    assigned_to: string | null;
    member_subject_erased: boolean;
    archived: boolean;
    frequency: string | null;
    recurrence_id: string | null;
  },
  once: boolean,
) {
  if (
    row.assigned_to !== null ||
    row.assigned_member_id === null ||
    row.member_subject_erased
  )
    return null;
  if (row.archived)
    return {
      state: "paused" as const,
      reason: "PROFILE_ARCHIVED" as const,
      recovery: "choose-active-member" as const,
      requiresCompatibleClient: false as const,
      actions: {
        complete: false as const,
        undo: false as const,
        verify: false as const,
        reject: false as const,
      },
    };
  const recurring =
    row.recurrence_id !== null ||
    (row.frequency !== null && row.frequency !== "once");
  if (once || !recurring || isProfileChoreRecurrenceSupported())
    return {
      state: "active" as const,
      requiresCompatibleClient: false as const,
      actions: {
        complete: true as const,
        undo: true as const,
        verify: true as const,
        reject: true as const,
      },
    };
  return {
    state: "paused" as const,
    reason: "RECURRENCE_CAPABILITY_UNAVAILABLE" as const,
    recovery: "refresh-and-retain-pending" as const,
    requiresCompatibleClient: true as const,
    actions: {
      complete: false as const,
      undo: false as const,
      verify: false as const,
      reject: false as const,
    },
  };
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}
function date(value: unknown): Date {
  return new Date(typeof value === "number" ? value : Number(value));
}
function day(value: unknown): string {
  return date(value).toISOString().slice(0, 10);
}

function activeProfile(
  row: {
    id: string;
    family_id: string;
    role: string;
    age: number | null;
    archived_at: number | null;
    erasure_user_id: string | null;
    legacy_user: string | null;
    linked_user: string | null;
  },
  familyId: string,
) {
  const role = profileRoleSchema.safeParse(row.role);
  return (
    row.family_id === familyId &&
    row.archived_at === null &&
    row.erasure_user_id === null &&
    row.legacy_user === null &&
    row.linked_user === null &&
    role.success &&
    isProfileAgeAllowed(role.data, row.age)
  );
}

function allowedLink(
  role: string | null | undefined,
  href: string,
  enabled = true,
): string | null {
  return enabled && canRoleAccessPath(role, href) ? href : null;
}

async function readFamily(db: D1Session, familyId: string) {
  return db
    .prepare(
      `SELECT features,weather_enabled,weather_label,weather_unit,weather_latitude,weather_longitude,
    ambient_idle_minutes,night_start,night_end,ambient_photo_ids FROM "Family" WHERE id=?1`,
    )
    .bind(familyId)
    .first<Row>();
}

async function readPhotos(
  db: D1Session,
  familyId: string,
  raw: unknown,
): Promise<BoardPhoto[]> {
  const ids = Array.isArray(raw)
    ? [
        ...new Set(
          raw.filter(
            (id): id is string =>
              typeof id === "string" && id.length > 0 && id.length <= 64,
          ),
        ),
      ].slice(0, MAX_AMBIENT_PHOTOS)
    : [];
  if (!ids.length) return [];
  const rows = await db
    .prepare(
      `SELECT id,filename,content_type FROM "Upload" WHERE family_id=?1 AND id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(familyId, JSON.stringify(ids))
    .all<{ id: string; filename: string; content_type: string }>();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row &&
      CHORE_PHOTO_FILENAME_RE.test(row.filename) &&
      DISPLAYABLE_PHOTO_TYPES.has(row.content_type)
      ? [{ id, url: chorePhotoPath(row.filename) }]
      : [];
  });
}

type ChoreRow = {
  id: string;
  created_at: number;
  title: string;
  due_date: number;
  status: string;
  assigned_to: string | null;
  assigned_member_id: string | null;
  member_subject_erased: number;
  frequency: string | null;
  recurrence_id: string | null;
  icon: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_family_id: string | null;
  profile_id: string | null;
  profile_family_id: string | null;
  profile_name: string | null;
  profile_role: string | null;
  profile_age: number | null;
  profile_archived_at: number | null;
  profile_erasure_user_id: string | null;
  profile_legacy_user: string | null;
  profile_linked_user: string | null;
};

async function readChores(
  store: D1Store,
  familyId: string,
  from: Date,
  through: Date,
  profileGate: boolean,
  memberProtocol: MemberProtocol,
): Promise<{ rows: ChoreRow[]; hasProfileRows: boolean }> {
  const db = store.withSession("first-primary");
  const rows: ChoreRow[] = [];
  let cursor: [number, number, string] | null = null;
  let hasProfileRows = false;
  // Keep going past hidden routine occurrences. A single SQL LIMIT must never
  // let paused/unsupported rows consume the visible board cap.
  for (let page = 0; page < 32 && rows.length < MAX_CHORES; page++) {
    const values: SqlValue[] = [familyId, from.getTime(), through.getTime()];
    let cursorSql = "";
    if (cursor) {
      values.push(cursor[0], cursor[1], cursor[2]);
      cursorSql = ` AND (c.due_date>?4 OR (c.due_date=?4 AND (c.created_at>?5 OR (c.created_at=?5 AND c.id>?6))))`;
    }
    const result = await db
      .prepare(
        `SELECT c.id,c.created_at,c.title,c.due_date,c.status,c.assigned_to,c.assigned_member_id,
      c.member_subject_erased,c.frequency,c.recurrence_id,c.icon,
      u.id AS assignee_id,u.name AS assignee_name,u.family_id AS assignee_family_id,
      m.id AS profile_id,m.family_id AS profile_family_id,m.name AS profile_name,m.role AS profile_role,m.age AS profile_age,
      m.archived_at AS profile_archived_at,m.erasure_user_id AS profile_erasure_user_id,
      lm.user_id AS profile_legacy_user,al.user_id AS profile_linked_user
      FROM "Chore" c
      LEFT JOIN "User" u ON u.id=c.assigned_to AND u.family_id=c.family_id
      LEFT JOIN "HouseholdMember" m ON m.id=c.assigned_member_id AND m.family_id=c.family_id
      LEFT JOIN "HouseholdMemberLegacyMapping" lm ON lm.member_id=m.id AND lm.family_id=m.family_id
      LEFT JOIN "HouseholdMemberAccountLink" al ON al.member_id=m.id AND al.family_id=m.family_id
      WHERE c.family_id=?1 AND c.due_date>=?2 AND c.due_date<?3
        AND (c.assigned_to IS NOT NULL OR c.assigned_member_id IS NOT NULL)${cursorSql}
      ORDER BY c.due_date ASC,c.created_at ASC,c.id ASC LIMIT 120`,
      )
      .bind(...values)
      .all<ChoreRow>();
    if (!result.results.length) break;
    const candidates = result.results;
    const hidden = new Set(
      await hiddenD1RoutineOccurrenceIds(
        familyId,
        { ids: candidates.map((row) => row.id) },
        store,
      ),
    );
    for (const row of candidates) {
      if (hidden.has(row.id)) continue;
      if (
        row.assigned_member_id &&
        activeProfile(
          {
            id: row.profile_id ?? "",
            family_id: row.profile_family_id ?? "",
            role: row.profile_role ?? "",
            age: row.profile_age,
            archived_at: row.profile_archived_at,
            erasure_user_id: row.profile_erasure_user_id,
            legacy_user: row.profile_legacy_user,
            linked_user: row.profile_linked_user,
          },
          familyId,
        )
      )
        hasProfileRows = true;
      rows.push(row);
      if (rows.length >= MAX_CHORES) break;
    }
    const last = candidates[candidates.length - 1];
    cursor = [last.due_date, last.created_at, last.id];
    if (candidates.length < 120) break;
  }
  return { rows, hasProfileRows };
}

async function hasVisibleProfileChore(
  store: D1Store,
  familyId: string,
  from: Date,
  through: Date,
): Promise<boolean> {
  const db = store.withSession("first-primary");
  const result = await db
    .prepare(
      `SELECT c.id FROM "Chore" c JOIN "HouseholdMember" m ON m.id=c.assigned_member_id AND m.family_id=c.family_id
    LEFT JOIN "HouseholdMemberLegacyMapping" lm ON lm.member_id=m.id AND lm.family_id=m.family_id
    LEFT JOIN "HouseholdMemberAccountLink" al ON al.member_id=m.id AND al.family_id=m.family_id
    WHERE c.family_id=?1 AND c.due_date>=?2 AND c.due_date<?3 AND c.assigned_to IS NULL AND c.assigned_member_id IS NOT NULL
      AND c.member_subject_erased=0 AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND lm.user_id IS NULL AND al.user_id IS NULL
      AND m.role IN ('child','teen','parent') AND (m.age IS NULL OR (m.role='child' AND m.age BETWEEN 0 AND 17) OR (m.role='teen' AND m.age BETWEEN 13 AND 17) OR (m.role='parent' AND m.age BETWEEN 18 AND 120))
    ORDER BY c.due_date,c.created_at,c.id LIMIT 500`,
    )
    .bind(familyId, from.getTime(), through.getTime())
    .all<{ id: string }>();
  if (!result.results.length) return false;
  const hidden = new Set(
    await hiddenD1RoutineOccurrenceIds(
      familyId,
      { ids: result.results.map((row) => row.id) },
      store,
    ),
  );
  return result.results.some((row) => !hidden.has(row.id));
}

async function readDinners(
  db: D1Session,
  familyId: string,
  from: Date,
  through: Date,
  withMissing: boolean,
) {
  const result = await db
    .prepare(
      `SELECT fm.id,fm.date,fm.recipe_name,fm.created_at,fm.recipe_id,
    u.name AS cook_name,u.family_id AS cook_family_id,r.title AS recipe_title,r.prep_time,r.family_id AS recipe_family_id
    FROM "FamilyMeal" fm LEFT JOIN "User" u ON u.id=fm.cook_id AND u.family_id=fm.family_id
    LEFT JOIN "Recipe" r ON r.id=fm.recipe_id AND r.family_id=fm.family_id
    WHERE fm.family_id=?1 AND fm.meal_type='dinner' AND fm.date>=?2 AND fm.date<?3
    ORDER BY fm.date ASC,fm.created_at ASC,fm.id ASC`,
    )
    .bind(familyId, from.getTime(), through.getTime())
    .all<Row>();
  const grouped = new Map<string, Row[]>();
  for (const row of result.results) {
    const key = day(row.date);
    const list = grouped.get(key) ?? [];
    if (list.length < 2) list.push(row);
    grouped.set(key, list);
  }
  const rows = [...grouped.values()].flatMap((list) =>
    list.slice(0, 1).map((row) => ({
      id: String(row.id),
      date: date(row.date),
      recipe_name: row.recipe_name == null ? null : String(row.recipe_name),
      cook:
        row.cook_name && row.cook_family_id === familyId
          ? { name: String(row.cook_name) }
          : null,
      recipe:
        row.recipe_title && row.recipe_family_id === familyId
          ? {
              title: String(row.recipe_title),
              prep_time: row.prep_time == null ? null : Number(row.prep_time),
              ingredients: [] as Array<{
                ingredient: { id: string; name: string; family_id: string };
              }>,
            }
          : null,
      recipeId: row.recipe_id == null ? null : String(row.recipe_id),
      hasMoreDinners: list.length > 1,
    })),
  );
  if (withMissing) {
    const recipeIds = [
      ...new Set(rows.flatMap((row) => (row.recipeId ? [row.recipeId] : []))),
    ];
    if (recipeIds.length) {
      const ingredients = await db
        .prepare(
          `SELECT ri.recipe_id,ri.ingredient_id,i.name,i.family_id FROM "RecipeIngredient" ri JOIN "Ingredient" i ON i.id=ri.ingredient_id
        WHERE ri.recipe_id IN (SELECT value FROM json_each(?1)) ORDER BY ri.id ASC LIMIT ?2`,
        )
        .bind(
          JSON.stringify(recipeIds),
          recipeIds.length * (BOARD_DINNER_INGREDIENT_MAX + 1),
        )
        .all<{
          recipe_id: string;
          ingredient_id: string;
          name: string;
          family_id: string;
        }>();
      const byRecipe = new Map<
        string,
        Array<{ ingredient: { id: string; name: string; family_id: string } }>
      >();
      for (const row of ingredients.results) {
        const list = byRecipe.get(row.recipe_id) ?? [];
        if (list.length <= BOARD_DINNER_INGREDIENT_MAX)
          list.push({
            ingredient: {
              id: row.ingredient_id,
              name: row.name,
              family_id: row.family_id,
            },
          });
        byRecipe.set(row.recipe_id, list);
      }
      for (const row of rows)
        if (row.recipe && row.recipeId)
          row.recipe.ingredients = byRecipe.get(row.recipeId) ?? [];
    }
  }
  return rows;
}

async function missingCounts(
  db: D1Session,
  familyId: string,
  dinners: Awaited<ReturnType<typeof readDinners>>,
  from: Date,
) {
  const recipeRows = dinners.filter(
    (row) =>
      row.recipe &&
      row.recipe.ingredients.length > 0 &&
      row.recipe.ingredients.length <= BOARD_DINNER_INGREDIENT_MAX,
  );
  if (!recipeRows.length) return new Map<string, number>();
  const inventory = await db
    .prepare(
      `SELECT ingredient_id,name,expires_on,date_kind,amount,status FROM "InventoryItem"
    WHERE family_id=?1 AND status='active' AND (amount IS NULL OR amount>0) AND (expires_on IS NULL OR expires_on>=?2) ORDER BY id ASC LIMIT 5001`,
    )
    .bind(familyId, from.getTime())
    .all<CookInventoryInput & { expires_on: number | null }>();
  if (inventory.results.length > 5000) return new Map<string, number>();
  const map = new Map<string, number>();
  for (const row of recipeRows) {
    if (
      !row.recipe ||
      row.recipe.ingredients.some(
        (line) => line.ingredient.family_id !== familyId,
      )
    )
      continue;
    const count = countMissingIngredients(
      row.recipe.ingredients,
      inventory.results.map((item) => ({
        ...item,
        expires_on: item.expires_on === null ? null : new Date(item.expires_on),
      })),
      parseDateDay(row.date),
    );
    if (count !== null) map.set(row.id, count);
  }
  return map;
}

function parseDateDay(value: Date): Date {
  return new Date(`${toDateOnlyUTC(value)}T00:00:00.000Z`);
}

async function readShopping(db: D1Session, familyId: string, include: boolean) {
  if (!include) return null;
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT li.id,li.content,li.quantity,l.id AS list_id,l.name AS list_name FROM "ListItem" li JOIN "List" l ON l.id=li.list_id
      WHERE l.family_id=?1 AND l.type IN ('grocery','shopping') AND li.checked=0 ORDER BY li.created_at ASC,li.id ASC LIMIT 5`,
      )
      .bind(familyId)
      .all<{
        id: string;
        content: string;
        quantity: number;
        list_id: string;
        list_name: string;
      }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM "ListItem" li JOIN "List" l ON l.id=li.list_id WHERE l.family_id=?1 AND l.type IN ('grocery','shopping') AND li.checked=0`,
      )
      .bind(familyId)
      .first<{ total: number }>(),
  ]);
  return {
    items: rows.results.map((row) => ({
      id: row.id,
      content: row.content,
      quantity: row.quantity,
      listId: row.list_id,
      listName: row.list_name,
    })),
    total: Number(count?.total ?? 0),
  };
}

async function readUseSoon(
  db: D1Session,
  familyId: string,
  now: Date,
): Promise<BoardUseSoonItem[]> {
  const today = addUTCDays(startOfTodayUTC(now), 1),
    skewFrom = addUTCDays(startOfTodayUTC(now), -1),
    until = addUTCDays(today, DEFAULT_USE_SOON_DAYS);
  const [main, skew] = await Promise.all([
    db
      .prepare(
        `SELECT id,name,location,expires_on,date_kind FROM "InventoryItem" WHERE family_id=?1 AND status='active' AND (amount IS NULL OR amount>0)
      AND expires_on IS NOT NULL AND expires_on<=?2 AND (date_kind!='use_by' OR expires_on>=?3) ORDER BY expires_on ASC,date_kind DESC,name ASC,id ASC LIMIT ?4`,
      )
      .bind(familyId, until.getTime(), today.getTime(), MAX_USE_SOON)
      .all<{
        id: string;
        name: string;
        location: string;
        expires_on: number;
        date_kind: string;
      }>(),
    db
      .prepare(
        `SELECT id,name,location,expires_on,date_kind FROM "InventoryItem" WHERE family_id=?1 AND status='active' AND (amount IS NULL OR amount>0)
      AND date_kind='use_by' AND expires_on>=?2 AND expires_on<?3 ORDER BY expires_on DESC,name ASC,id ASC LIMIT ?4`,
      )
      .bind(familyId, skewFrom.getTime(), today.getTime(), MAX_USE_SOON)
      .all<{
        id: string;
        name: string;
        location: string;
        expires_on: number;
        date_kind: string;
      }>(),
  ]);
  const rows = [...main.results, ...skew.results];
  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      location: asLocation(row.location) as InventoryLocation,
      expiresOn: day(row.expires_on),
      dateKind: asDateKind(row.date_kind) as DateKind,
    }))
    .sort(
      (a, b) =>
        a.expiresOn.localeCompare(b.expiresOn) ||
        (a.dateKind === "use_by" ? 0 : 1) - (b.dateKind === "use_by" ? 0 : 1) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

async function readPreparation(
  db: D1Session,
  familyId: string,
  ids: string[],
  memberProtocol: MemberProtocol,
): Promise<Record<string, { eventTitle: string }>> {
  if (!eventPreparationReady() || !ids.length) return {};
  const result = await db
    .prepare(
      `SELECT c.id AS chore_id,e.title AS event_title,f.features FROM "EventPreparationStep" s
    JOIN "EventPreparation" p ON p.id=s.preparation_id AND p.family_id=s.family_id JOIN "Chore" c ON c.id=s.chore_id AND c.family_id=s.family_id
    JOIN "Event" e ON e.id=p.event_id AND e.family_id=p.family_id JOIN "Family" f ON f.id=p.family_id
    LEFT JOIN "HouseholdMember" m ON m.id=c.assigned_member_id AND m.family_id=c.family_id
    LEFT JOIN "HouseholdMemberLegacyMapping" lm ON lm.member_id=m.id AND lm.family_id=m.family_id LEFT JOIN "HouseholdMemberAccountLink" al ON al.member_id=m.id AND al.family_id=m.family_id
    WHERE p.family_id=?1 AND c.id IN (SELECT value FROM json_each(?2)) AND c.member_subject_erased=0 AND c.is_template=0
      AND ((c.assigned_member_id IS NULL AND EXISTS(SELECT 1 FROM "User" u WHERE u.id=c.assigned_to AND u.family_id=c.family_id)) OR
        (?3=1 AND c.assigned_to IS NULL AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND lm.user_id IS NULL AND al.user_id IS NULL
          AND m.role IN ('child','teen','parent') AND (m.age IS NULL OR (m.role='child' AND m.age BETWEEN 0 AND 17) OR (m.role='teen' AND m.age BETWEEN 13 AND 17) OR (m.role='parent' AND m.age BETWEEN 18 AND 120))))
    ORDER BY c.id LIMIT 80`,
    )
    .bind(
      familyId,
      JSON.stringify([...new Set(ids)].slice(0, 80)),
      Number(memberProtocol === 2 && isProfileChoreEnabled()),
    )
    .all<{ chore_id: string; event_title: string; features: string | null }>();
  const out: Record<string, { eventTitle: string }> = {};
  for (const row of result.results)
    if (
      isFeatureEnabled(
        normalizeFeatures(jsonValue(row.features)),
        "calendar",
      ) &&
      isFeatureEnabled(normalizeFeatures(jsonValue(row.features)), "chores")
    )
      out[row.chore_id] = { eventTitle: row.event_title.slice(0, 512) };
  return out;
}

export async function readD1TodayBoard(
  options: D1TodayBoardOptions,
  database?: D1Store,
): Promise<D1TodayBoardResult> {
  const store = database ?? (await getD1Database());
  const db = store.withSession("first-primary");
  const now = options.now ?? new Date();
  const isDevice = options.audience === "device";
  const role = isDevice ? undefined : options.role;
  const memberProtocol = options.memberProtocol ?? 1;
  const profileGate = isProfileChoreEnabled();
  const profileReader = profileGate && memberProtocol === 2;
  const protocolError =
    memberProtocol === 2 && !profileGate ? profileProtocolRefusal() : undefined;
  const family = await readFamily(db, options.familyId);
  const features = normalizeFeatures(jsonValue(family?.features));
  const from = addUTCDays(startOfTodayUTC(now), -1);
  const through = addUTCDays(startOfTodayUTC(now), COMING_UP_DAYS + 2);
  // Keep the payload aligned with the visible Lists feature as well as the
  // role route gate. The legacy reader does not expose shopping when Lists
  // is disabled; the native reader must not leak a stale grocery snapshot
  // into a board whose family turned Lists off.
  const includeShopping =
    isFeatureEnabled(features, "lists") &&
    (isDevice || canRoleAccessPath(role, "/dashboard/lists"));
  const withMissing =
    !isDevice &&
    isFeatureEnabled(features, "meals") &&
    isFeatureEnabled(features, "inventory");

  const [
    membersResult,
    profilesResult,
    eventsResult,
    choresResult,
    dinners,
    shopping,
    useSoon,
    photos,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT id,name,board_color,created_at FROM "User" WHERE family_id=?1 ORDER BY created_at ASC,id ASC`,
      )
      .bind(options.familyId)
      .all<{
        id: string;
        name: string;
        board_color: string | null;
        created_at: number;
      }>(),
    profileReader
      ? db
          .prepare(
            `SELECT m.id,m.family_id,m.name,m.role,m.age,m.board_color,m.archived_at,m.erasure_user_id,lm.user_id AS legacy_user,al.user_id AS linked_user
      FROM "HouseholdMember" m LEFT JOIN "HouseholdMemberLegacyMapping" lm ON lm.member_id=m.id AND lm.family_id=m.family_id LEFT JOIN "HouseholdMemberAccountLink" al ON al.member_id=m.id AND al.family_id=m.family_id
      WHERE m.family_id=?1 AND m.archived_at IS NULL AND m.erasure_user_id IS NULL AND lm.user_id IS NULL AND al.user_id IS NULL ORDER BY m.created_at ASC,m.id ASC`,
          )
          .bind(options.familyId)
          .all<Row>()
      : Promise.resolve({ results: [] as Row[] }),
    db
      .prepare(
        `SELECT e.id,e.title,e.start_time,e.end_time,e.is_task,e.source_subscription_id,e.source_connection_id,e.created_by,s.name AS source_name,s.color AS source_color
      FROM "Event" e LEFT JOIN "CalendarSubscription" s ON s.id=e.source_subscription_id AND s.family_id=e.family_id
      WHERE e.family_id=?1 AND e.end_time>?2 AND e.start_time<?3 ORDER BY e.start_time ASC,e.id ASC LIMIT ?4`,
      )
      .bind(options.familyId, now.getTime(), through.getTime(), MAX_EVENTS)
      .all<Row>(),
    readChores(
      store,
      options.familyId,
      from,
      through,
      profileGate,
      memberProtocol,
    ),
    isFeatureEnabled(features, "meals")
      ? readDinners(db, options.familyId, from, through, withMissing)
      : Promise.resolve([]),
    readShopping(db, options.familyId, includeShopping),
    isFeatureEnabled(features, "inventory")
      ? readUseSoon(db, options.familyId, now)
      : Promise.resolve(null),
    isDevice
      ? Promise.resolve([] as BoardPhoto[])
      : readPhotos(db, options.familyId, jsonValue(family?.ambient_photo_ids)),
  ]);

  const accountColors = membersResult.results.map((row) => ({
    id: row.id,
    board_color: row.board_color,
  }));
  const profiles = profilesResult.results.filter((row) =>
    activeProfile(
      {
        id: String(row.id),
        family_id: String(row.family_id),
        role: String(row.role),
        age: row.age == null ? null : Number(row.age),
        archived_at: row.archived_at == null ? null : Number(row.archived_at),
        erasure_user_id:
          row.erasure_user_id == null ? null : String(row.erasure_user_id),
        legacy_user: row.legacy_user == null ? null : String(row.legacy_user),
        linked_user: row.linked_user == null ? null : String(row.linked_user),
      },
      options.familyId,
    ),
  );
  const profileIds = new Set(profiles.map((row) => String(row.id)));
  const colorRows = [
    ...accountColors,
    ...profiles.map((row) => ({
      id: `profile:${row.id}`,
      board_color: row.board_color as string | null,
    })),
  ];
  const colors = resolveMemberColors(colorRows);
  const boardMembers: BoardMember[] = [
    ...membersResult.results.map((row) => ({
      id: row.id,
      name: row.name,
      color: colors.get(row.id),
      ...(profileGate && memberProtocol === 2
        ? {
            subject: {
              kind: "account" as const,
              accountId: row.id,
              name: row.name,
            },
          }
        : {}),
    })),
    ...profiles.map((row) => ({
      id: `profile:${row.id}`,
      name: String(row.name),
      color: colors.get(`profile:${row.id}`),
      subject: {
        kind: "profile" as const,
        memberId: String(row.id),
        name: String(row.name),
        color: colors.get(`profile:${row.id}`)!,
      },
    })),
  ];
  const accountIds = new Set(membersResult.results.map((row) => row.id));
  const scheduledOnce = await scheduledOnceD1RoutineOccurrenceIds(
    options.familyId,
    choresResult.rows
      .filter(
        (row) => row.assigned_to === null && row.assigned_member_id !== null,
      )
      .map((row) => row.id),
    store,
  );
  const boardChores: BoardChore[] = choresResult.rows.flatMap((row) => {
    const base = {
      id: row.id,
      title: row.title,
      dueDay: day(row.due_date),
      status: row.status,
      icon: isRoutineIconKey(row.icon) ? row.icon : null,
    };
    if (row.assigned_to !== null) {
      if (
        !accountIds.has(row.assigned_to) ||
        row.assignee_family_id !== options.familyId
      )
        return [];
      const item: BoardChore = { ...base, assigneeId: row.assigned_to };
      if (profileGate && memberProtocol === 2)
        item.subject = {
          kind: "account",
          accountId: row.assigned_to,
          name: String(row.assignee_name ?? ""),
        };
      return [item];
    }
    if (
      !profileReader ||
      !row.assigned_member_id ||
      !profileIds.has(row.assigned_member_id)
    )
      return [];
    const profile = profiles.find(
      (value) => String(value.id) === row.assigned_member_id,
    );
    if (!profile) return [];
    const subject: BoardSubject = {
      kind: "profile",
      memberId: row.assigned_member_id,
      name: String(profile.name),
      color: colors.get(`profile:${row.assigned_member_id}`)!,
    };
    const actionAvailability = profileAction(
      {
        assigned_to: null,
        assigned_member_id: row.assigned_member_id,
        member_subject_erased: bool(row.member_subject_erased),
        archived: row.profile_archived_at !== null,
        frequency: row.frequency,
        recurrence_id: row.recurrence_id,
      },
      scheduledOnce.has(row.id),
    );
    return [
      {
        ...base,
        subject,
        ...(actionAvailability ? { actionAvailability } : {}),
      },
    ];
  });
  const profileCompatibility =
    memberProtocol === 1 || !profileGate
      ? await hasVisibleProfileChore(store, options.familyId, from, through)
      : false;
  const dinnerCounts = withMissing
    ? await missingCounts(db, options.familyId, dinners, from)
    : new Map<string, number>();
  const prep =
    protocolError || (choresResult.hasProfileRows && memberProtocol === 1)
      ? {}
      : await readPreparation(
          db,
          options.familyId,
          boardChores.map((row) => row.id),
          memberProtocol,
        );
  const events: BoardEvent[] = eventsResult.results.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    start: date(row.start_time).toISOString(),
    end: date(row.end_time).toISOString(),
    isTask: bool(row.is_task),
    source: row.source_subscription_id
      ? {
          name: String(row.source_name ?? "Subscribed calendar"),
          color: row.source_color == null ? null : String(row.source_color),
        }
      : null,
    addedById:
      !row.source_subscription_id &&
      !row.source_connection_id &&
      accountIds.has(String(row.created_by))
        ? String(row.created_by)
        : null,
  }));
  const boardDinners: BoardDinner[] | null = isFeatureEnabled(features, "meals")
    ? dinners.map((row) => ({
        id: row.id,
        day: day(row.date),
        hasMoreDinners: row.hasMoreDinners,
        recipeName: row.recipe_name?.trim() || null,
        cookName: row.cook?.name ?? null,
        recipeTitle: row.recipe?.title?.trim() || null,
        prepMinutes: row.recipe?.prep_time ?? null,
        ...(dinnerCounts.has(row.id)
          ? { missingIngredients: dinnerCounts.get(row.id) }
          : {}),
      }))
    : null;
  const display: BoardDisplay = {
    idleMinutes: idleMinutesFrom(
      family?.ambient_idle_minutes == null
        ? undefined
        : Number(family.ambient_idle_minutes),
    ),
    night: nightHoursFrom(
      family?.night_start as string | null,
      family?.night_end as string | null,
    ),
    ...(isDevice ? {} : { photos }),
  };
  const weatherKey = isWeatherEnabledForFamily(family)
    ? [
        family?.weather_label,
        family?.weather_unit,
        family?.weather_latitude,
        family?.weather_longitude,
      ]
    : null;
  const weather: BoardWeather | null = options.withWeather
    ? await getD1BoardWeather(
        options.familyId,
        now,
        {
          enabled: bool(family?.weather_enabled),
          latitude: Number(family?.weather_latitude),
          longitude: Number(family?.weather_longitude),
          label:
            family?.weather_label == null ? null : String(family.weather_label),
          unit:
            family?.weather_unit == null ? null : String(family.weather_unit),
        },
        store,
      )
    : null;
  const links = isDevice
    ? { ...NO_LINKS }
    : {
        calendar: allowedLink(
          role,
          "/dashboard/calendar",
          isFeatureEnabled(features, "calendar"),
        ),
        chores: allowedLink(
          role,
          "/dashboard/chores",
          isFeatureEnabled(features, "chores"),
        ),
        meals: allowedLink(
          role,
          "/dashboard/meals",
          isFeatureEnabled(features, "meals"),
        ),
        lists: allowedLink(
          role,
          "/dashboard/lists/groceries",
          isFeatureEnabled(features, "lists"),
        ),
        features: allowedLink(role, "/dashboard/features"),
        inventory: allowedLink(
          role,
          "/dashboard/inventory",
          isFeatureEnabled(features, "inventory"),
        ),
      };
  const data: TodayBoardData = {
    generatedAt: now.toISOString(),
    memberProtocol,
    members: boardMembers,
    events,
    chores: boardChores,
    ...(Object.keys(prep).length ? { sharedPreparationContext: prep } : {}),
    dinners: boardDinners,
    shopping,
    useSoon: useSoon ? useSoon : null,
    links,
    ...(isDevice && includeShopping
      ? { groceryLists: await readGroceryLists(db, options.familyId) }
      : {}),
    ...(profileCompatibility ||
    (choresResult.hasProfileRows && memberProtocol === 1)
      ? { protocolError: profileProtocolRefusal() }
      : {}),
    ...(protocolError ? { protocolError } : {}),
    display,
    weather: options.withWeather ? weather : undefined,
  };
  return { data, weatherKey };
}

async function readGroceryLists(db: D1Session, familyId: string) {
  const rows = await db
    .prepare(
      `SELECT id,name FROM "List" WHERE family_id=?1 AND type='grocery' ORDER BY created_at ASC,id ASC LIMIT 50`,
    )
    .bind(familyId)
    .all<{ id: string; name: string }>();
  return rows.results;
}

function isWeatherEnabledForFamily(row: Row | null): boolean {
  return (
    isWeatherEnabled() &&
    bool(row?.weather_enabled) &&
    Number.isFinite(Number(row?.weather_latitude)) &&
    Number.isFinite(Number(row?.weather_longitude))
  );
}
