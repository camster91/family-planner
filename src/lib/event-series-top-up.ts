/**
 * Read-path top-up for repeating events (no scheduler; AGENTS.md, O-33).
 * Pages and the events route call this before they read. It never throws:
 * a failed top-up leaves the rows already written, and the read goes on.
 */
import { storageBackend } from './storage-backend'
import { eventRepeatReady } from './event-series'

export async function topUpHouseholdEventSeries(familyId: string | null | undefined, now: Date = new Date(), wantedMs?: number): Promise<void> {
  if (!familyId || !eventRepeatReady()) return
  try {
    if (storageBackend() === 'd1') {
      const [{ getD1Database }, { topUpD1EventSeries }] = await Promise.all([import('./cloudflare/database'), import('./cloudflare/event-series')])
      await topUpD1EventSeries((await getD1Database()).withSession('first-primary'), familyId, now, wantedMs)
    } else {
      const [{ prisma }, { topUpEventSeries }] = await Promise.all([import('./prisma'), import('./event-series-db')])
      if (prisma) await topUpEventSeries(prisma, familyId, now, wantedMs)
    }
  } catch (cause) {
    console.warn('[event-series] top-up could not finish', cause instanceof Error ? cause.name : 'unknown error')
  }
}
