/** Shared fingerprint serialization. Neither content nor hash is authorization. */
export function canonicalRequestJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value ?? null);
  if (Array.isArray(value))
    return `[${value.map(canonicalRequestJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalRequestJson(child)}`).join(",")}}`;
}
export async function hashBrowserIdempotentRequest(
  action: string,
  body: unknown,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return "";
  const bytes = new TextEncoder().encode(
    `${action}\n${canonicalRequestJson(body)}`,
  );
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
