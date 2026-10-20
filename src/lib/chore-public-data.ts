/** Parent future definitions are never part of an ordinary occurrence response. */
type PrivateRoutineKey = "routine_series_config" | "schedule_config";
export type PublicChoreData<T> = T extends Date
  ? T
  : T extends readonly (infer U)[]
    ? PublicChoreData<U>[]
    : T extends object
      ? {
          [
            K in keyof T as K extends PrivateRoutineKey ? never : K
          ]: PublicChoreData<T[K]>;
        }
      : T;
/** Also covers nested template/chore values and historic cached response shapes. */
export function publicChoreData<T>(value: T): PublicChoreData<T> {
  const visit = (input: unknown, depth: number): unknown => {
    if (depth > 32) throw new Error("Chore response nesting exceeds contract");
    if (input === null || typeof input !== "object" || input instanceof Date)
      return input;
    if (Array.isArray(input)) return input.map((row) => visit(row, depth + 1));
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(input)) {
      if (key === "routine_series_config" || key === "schedule_config")
        continue;
      Object.defineProperty(output, key, {
        value: visit(item, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return output;
  };
  return visit(value, 0) as PublicChoreData<T>;
}
