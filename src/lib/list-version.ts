/** Server-only, content-free version of one canonical list's membership and fields. */
import { createHash } from "node:crypto";

type Versioned = { id: string; updated_at: Date };

export function listVersion(
  list: Versioned,
  items: readonly Versioned[],
): string {
  const rows = items.map((item) => [item.id, item.updated_at.toISOString()]);
  rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return createHash("sha256")
    .update(JSON.stringify([list.id, list.updated_at.toISOString(), rows]))
    .digest("hex");
}
