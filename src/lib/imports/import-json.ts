/** Raw import JSON validation: never choose a last-wins object property. */
export const IMPORT_JSON_MAX_DEPTH = 256;
export const IMPORT_JSON_MAX_CHARS = 10 * 1024 * 1024;
export class ImportJsonError extends Error {
  constructor(
    public readonly code: "DUPLICATE_KEY" | "DEPTH_LIMIT" | "TEXT_LIMIT",
  ) {
    super("Import JSON requires review"); // No property names or source fragments.
    this.name = "ImportJsonError";
  }
}
type Frame =
  | { kind: "array" }
  | { kind: "object"; keys: Set<string>; expectingKey: boolean };
/**
 * This scan only rejects ambiguity/resource depth. Native JSON.parse remains
 * the syntax/value authority and is always called before returning a value.
 * Keys are decoded as JSON strings, so escaped aliases collide too. Strings'
 * internal punctuation is skipped; keys are scoped per object, never globally.
 * No recursion, key normalization, value coercion, source repair or logging.
 * Callers own UTF-8 byte limits; this character/depth gate is not allocation or
 * CPU preemption, and number semantics remain ordinary JSON.parse semantics.
 */
export function parseImportJson(text: string): unknown {
  if (text.length > IMPORT_JSON_MAX_CHARS)
    throw new ImportJsonError("TEXT_LIMIT");
  const stack: Frame[] = [];
  for (let index = 0; index < text.length;) {
    const char = text[index];
    if (char === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === "\\") {
          index += 2;
          continue;
        }
        if (text[index++] === '"') break;
      }
      const frame = stack[stack.length - 1];
      if (frame?.kind === "object" && frame.expectingKey) {
        let next = index;
        while (next < text.length && /[ \t\r\n]/.test(text[next])) next++;
        if (text[next] === ":") {
          const key: unknown = JSON.parse(text.slice(start, index));
          if (typeof key !== "string")
            throw new SyntaxError("Invalid import JSON key");
          if (frame.keys.has(key)) throw new ImportJsonError("DUPLICATE_KEY");
          frame.keys.add(key);
          frame.expectingKey = false;
        }
      }
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(
        char === "{"
          ? { kind: "object", keys: new Set(), expectingKey: true }
          : { kind: "array" },
      );
      if (stack.length > IMPORT_JSON_MAX_DEPTH)
        throw new ImportJsonError("DEPTH_LIMIT");
    } else if (char === "}" || char === "]") {
      stack.pop(); // Native parser below rejects unmatched/mismatched structure.
    } else if (char === ",") {
      const frame = stack[stack.length - 1];
      if (frame?.kind === "object") frame.expectingKey = true;
    }
    index++;
  }
  return JSON.parse(text) as unknown;
}
