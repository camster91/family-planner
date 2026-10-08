/** Passive, bounded shared-board snapshot. SHARED_DEVICE.md §8 / #135.
 * Never stores identity responses, credentials, elevation or private fields.
 * Every nested object is projected on write AND read, so future DTO fields
 * cannot silently expand what persists. Revocation uses the existing namespace purge.
 */
import { z } from "zod";
import type { TodayBoardData } from "@/app/dashboard/today/today-board-data";
import { DEVICE_STORAGE_PREFIX } from "@/lib/device-client";
import { MEMBER_COLOR_KEYS } from "@/lib/member-colors";

export const DEVICE_BOARD_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const DEVICE_BOARD_MAX_BYTES = 256 * 1024;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = z.string().max(2048);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const weatherIcon = z.enum([
  "clear",
  "partly",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "snow",
  "storm",
]);

// Zod objects strip unknown fields by default, including nested private fields.
const boardSchema: z.ZodType<TodayBoardData, z.ZodTypeDef, unknown> = z.object({
  generatedAt: z.string().datetime(),
  members: z
    .array(
      z.object({ id, name: text, color: z.enum(MEMBER_COLOR_KEYS).optional() }),
    )
    .max(500),
  events: z
    .array(
      z.object({
        id,
        title: text,
        start: z.string().datetime(),
        end: z.string().datetime(),
        isTask: z.boolean(),
        source: z
          .object({ name: text, color: z.string().max(128).nullable() })
          .nullable(),
        addedById: id.nullable().optional(),
      }),
    )
    .max(60),
  chores: z
    .array(
      z.object({
        id,
        title: text,
        dueDay: day,
        status: z.string().max(64),
        assigneeId: id,
        icon: z.string().max(128).nullable().optional(),
      }),
    )
    .max(80),
  dinners: z
    .array(
      z.object({
        id,
        day,
        recipeName: text.nullable(),
        cookName: text.nullable(),
        recipeTitle: text.nullable().optional(),
        prepMinutes: z.number().finite().nonnegative().nullable().optional(),
      }),
    )
    .max(60)
    .nullable(),
  shopping: z
    .object({
      items: z
        .array(
          z.object({
            id,
            content: text,
            quantity: z.number().finite().nonnegative(),
            listId: id,
            listName: text,
          }),
        )
        .max(100),
      total: z.number().int().nonnegative(),
    })
    .nullable(),
  groceryLists: z
    .array(z.object({ id, name: text }))
    .max(50)
    .optional(),
  useSoon: z
    .array(
      z.object({
        id,
        name: text,
        location: z.enum(["fridge", "freezer", "pantry"]),
        expiresOn: day,
        dateKind: z.enum(["best_before", "use_by"]).optional(),
      }),
    )
    .max(50)
    .nullable()
    .optional(),
  // Cached views have no navigation to parent pages, even for poisoned storage.
  links: z.object({}).transform(() => ({
    calendar: null,
    chores: null,
    meals: null,
    lists: null,
    features: null,
    inventory: null,
  })),
  weather: z
    .object({
      label: text,
      unit: z.enum(["C", "F"]),
      current: z.object({
        temperature: z.number().finite(),
        summary: text,
        icon: weatherIcon,
        isDay: z.boolean(),
      }),
      days: z
        .array(
          z.object({
            day,
            high: z.number().finite(),
            low: z.number().finite(),
            summary: text,
            icon: weatherIcon,
            precipitationChance: z.number().min(0).max(100).nullable(),
          }),
        )
        .max(4),
      utcOffsetSeconds: z.number().finite().optional(),
      fetchedAt: z.string().datetime(),
    })
    .nullable()
    .optional(),
  display: z
    .object({
      idleMinutes: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(30),
      ]),
      night: z.object({ start: clock, end: clock }).nullable(),
    })
    .optional(),
  version: z.string().max(128).optional(),
});

const envelopeSchema = z.object({
  v: z.literal(1),
  deviceId: id,
  savedAt: z.number().finite(),
  board: boardSchema,
});
export type BoardCacheStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;
export type BoardCacheResult =
  | { state: "ready"; board: TodayBoardData; savedAt: number }
  | { state: "missing" | "expired" | "invalid" };

function keyFor(deviceId: string): string | null {
  return id.safeParse(deviceId).success
    ? `${DEVICE_STORAGE_PREFIX}${deviceId}:today`
    : null;
}

export function clearDeviceBoardCache(
  storage: BoardCacheStorage | null,
  deviceId: string,
): void {
  const key = keyFor(deviceId);
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    /* Best effort; live loading still works. */
  }
}

export function readDeviceBoardCache(
  storage: BoardCacheStorage | null,
  deviceId: string,
  now: number,
): BoardCacheResult {
  const key = keyFor(deviceId);
  if (!storage || !key) return { state: "missing" };
  try {
    const raw = storage.getItem(key);
    if (raw === null) return { state: "missing" };
    if (new Blob([raw]).size > DEVICE_BOARD_MAX_BYTES)
      throw new Error("oversized cache");
    const parsed = envelopeSchema.safeParse(JSON.parse(raw));
    if (
      !parsed.success ||
      parsed.data.deviceId !== deviceId ||
      !Number.isFinite(now)
    )
      throw new Error("invalid cache");
    const { savedAt, board } = parsed.data;
    // A backwards clock jump cannot extend the maximum display lifetime.
    if (savedAt > now || now - savedAt >= DEVICE_BOARD_MAX_AGE_MS) {
      storage.removeItem(key);
      return { state: "expired" };
    }
    return { state: "ready", board, savedAt };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      /* Storage failures never block live loading. */
    }
    return { state: "invalid" };
  }
}

export function writeDeviceBoardCache(
  storage: BoardCacheStorage | null,
  deviceId: string,
  board: unknown,
  now: number,
): boolean {
  const key = keyFor(deviceId);
  if (!storage || !key || !Number.isFinite(now)) return false;
  const parsed = boardSchema.safeParse(board);
  if (!parsed.success) return false;
  try {
    const raw = JSON.stringify({
      v: 1,
      deviceId,
      savedAt: now,
      board: parsed.data,
    });
    if (new Blob([raw]).size > DEVICE_BOARD_MAX_BYTES) return false;
    storage.setItem(key, raw);
    return true;
  } catch {
    return false;
  }
}
