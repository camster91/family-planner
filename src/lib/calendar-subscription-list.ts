/** Browser-safe list admission; no feed URLs, credentials or server imports. */
export const MAX_SUBSCRIPTIONS_PER_FAMILY = 10;

export interface CalendarSubscriptionSummary {
  id: string;
  name: string;
  color: string | null;
  url_hint?: string;
  last_fetched_at: string | null;
  last_status: string;
  last_error: string | null;
}

export function readCalendarSubscriptionList(value: unknown): CalendarSubscriptionSummary[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rows = (value as Record<string, unknown>).subscriptions;
  if (!Array.isArray(rows) || rows.length > MAX_SUBSCRIPTIONS_PER_FAMILY) return null;
  const seen = new Set<string>();
  const summaries: CalendarSubscriptionSummary[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || row.id.length > 256 || seen.has(row.id)
      || typeof row.name !== "string" || !row.name.trim() || row.name.length > 60
      || (row.color !== null && (typeof row.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(row.color)))
      || (row.url_hint !== undefined && (typeof row.url_hint !== "string" || row.url_hint.length > 2048))
      || (row.last_fetched_at !== null && (typeof row.last_fetched_at !== "string" || row.last_fetched_at.length > 64 || !Number.isFinite(Date.parse(row.last_fetched_at))))
      || typeof row.last_status !== "string" || !["pending", "ok", "error"].includes(row.last_status)
      || (row.last_error !== null && (typeof row.last_error !== "string" || row.last_error.length > 2048))) return null;
    seen.add(row.id);
    // Project only the existing public summary. Unknown extras are never retained.
    summaries.push({ id: row.id, name: row.name, color: row.color as string | null,
      ...(row.url_hint !== undefined ? { url_hint: row.url_hint as string } : {}),
      last_fetched_at: row.last_fetched_at as string | null,
      last_status: row.last_status as string, last_error: row.last_error as string | null });
  }
  return summaries;
}
