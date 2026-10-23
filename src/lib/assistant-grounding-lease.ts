/** A typed projection is usable only in its original local day and time lease.
 * This is freshness, not evidence that a model's prose is factually grounded. */
export function assistantGroundingLeaseCurrent(
  context: {
    generatedAt: string;
    expiresAt: string;
    viewer: { timeZone: string; localDate: string };
  },
  now: number,
): boolean {
  const start = Date.parse(context.generatedAt),
    end = Date.parse(context.expiresAt);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 60_000 ||
    now < start ||
    now >= end
  )
    return false;
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: context.viewer.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const part = (kind: Intl.DateTimeFormatPartTypes) =>
      parts.find((p) => p.type === kind)?.value;
    return (
      `${part("year")}-${part("month")}-${part("day")}` ===
      context.viewer.localDate
    );
  } catch {
    return false;
  }
}
