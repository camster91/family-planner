/**
 * Zod-free primitives for the few contracts the cold dashboard shell checks in
 * the browser (#413 initial JavaScript budget).
 *
 * Any Zod import pulls the shared Zod core into a route's initial JavaScript,
 * and that core carries every schema kind any client route uses. The startup
 * validators built on these helpers mirror the Zod Mini `strictObject`
 * semantics of the canonical schemas they shadow: an object is a non-null,
 * non-array object; every enumerable key (own or inherited) must be known;
 * numbers must be finite; results are fresh values in schema key order.
 * Parity with each canonical Zod schema is enforced by
 * src/lib/__tests__/browser-shape-parity.test.ts. The Zod schemas stay the
 * contract for servers and every non-startup surface.
 */

export type ShapeResult<T> = { success: true; data: T } | { success: false };

export const SHAPE_FAILURE: ShapeResult<never> = Object.freeze({
  success: false,
});

export function shapeSuccess<T>(data: T): ShapeResult<T> {
  return { success: true, data };
}

export type ShapeRecord = Record<string, unknown>;

/** A Zod object input: non-null, non-array object, with only known keys. */
export function strictRecord(
  value: unknown,
  keys: readonly string[],
): ShapeRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const record = value as ShapeRecord;
  for (const key in record) if (!keys.includes(key)) return null;
  return record;
}

export function isStringLength(
  value: unknown,
  min: number,
  max: number,
): value is string {
  return (
    typeof value === "string" && value.length >= min && value.length <= max
  );
}

export function matchesPattern(
  value: unknown,
  pattern: RegExp,
): value is string {
  return typeof value === "string" && pattern.test(value);
}

/** `z.number().check(z.int(), z.nonnegative())` and `z.gte(0)`. */
export function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return (
    typeof value === "string" && (options as readonly string[]).includes(value)
  );
}

/** A fresh dense copy when every element passes; holes read as undefined. */
export function arrayOf<T>(
  value: unknown,
  maxLength: number,
  item: (entry: unknown) => entry is T,
): T[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null;
  const out: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry: unknown = value[index];
    if (!item(entry)) return null;
    out.push(entry);
  }
  return out;
}
