/** Browser equivalent of the server's exact canonical request digest. Only
 * validated JSON data is accepted; key order does not change the command. */
import { preparationCommand } from "./contract";
import { PREPARATION_ACTION } from "./http";
export function canonicalPreparationJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value))
    return `[${value.map(canonicalPreparationJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, value]) => `${JSON.stringify(key)}:${canonicalPreparationJson(value)}`).join(",")}}`;
}
export async function preparationRequestHash(raw: unknown) {
  const command = preparationCommand.parse(raw);
  const bytes = new TextEncoder().encode(
    `${PREPARATION_ACTION}\n${canonicalPreparationJson(command)}`,
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
