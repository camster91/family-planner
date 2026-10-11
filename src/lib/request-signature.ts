/** Stable JSON for binding a retry key to one logical request body. */
export function canonicalBodySignature(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalBodySignature).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalBodySignature(record[key])}`)
    .join(",")}}`;
}
