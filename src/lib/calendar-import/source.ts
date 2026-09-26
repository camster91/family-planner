// Helpers for showing and protecting imported (read-only) events (#232).

export const EVENT_READ_ONLY_CODE = "EVENT_READ_ONLY";
export const EVENT_READ_ONLY_MESSAGE =
  "This event comes from a subscribed calendar and is read-only here. Change it in the original calendar.";

export interface EventSource {
  subscription_id: string;
  name: string;
  color: string | null;
}

/**
 * Attach `source` ({ subscription_id, name, color } or null) to each event.
 * Subscription names are looked up in the caller's family only, so a foreign
 * subscription id can never resolve to another household's name.
 */
export async function attachEventSources<
  T extends { source_subscription_id?: string | null },
>(
  db: any,
  familyId: string,
  events: T[],
): Promise<Array<T & { source: EventSource | null }>> {
  const ids = [
    ...new Set(
      events
        .map((e) => e.source_subscription_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const byId = new Map<
    string,
    { id: string; name: string; color: string | null }
  >();
  if (ids.length > 0) {
    const subs: Array<{ id: string; name: string; color: string | null }> =
      await db.calendarSubscription.findMany({
        where: { id: { in: ids }, family_id: familyId },
        select: { id: true, name: true, color: true },
      });
    for (const s of subs) byId.set(s.id, s);
  }
  return events.map((e) => {
    const sub = e.source_subscription_id
      ? byId.get(e.source_subscription_id)
      : undefined;
    return {
      ...e,
      source: e.source_subscription_id
        ? {
            subscription_id: e.source_subscription_id,
            name: sub?.name ?? "Subscribed calendar",
            color: sub?.color ?? null,
          }
        : null,
    };
  });
}
