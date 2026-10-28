import { AssistantSourceRefused, readAssistantSourceProof, assistantSourceSnapshotCurrent, assistantSourceLeaseEnd, isAssistantConfirmationEnabled, type AssistantSourceGuard, type AssistantProofActor } from '@/lib/assistant-source-proof'
import { loadAssistantTodayFromReads, type AssistantTodayDb } from '@/lib/assistant-today-context'
import { referenceAssistantToday, type AssistantSourceRow } from '@/lib/assistant-references'
import type { AssistantConfirmationKind } from '@/lib/assistant-reference-contract'
import { captureD1Reads } from './read-witness'
import type { NativeD1 } from './read-client'
import type { D1Store } from './database'
import { d1WriteCheck } from './write-check'

/** A signed context is freshness evidence, never authority to perform an action.
 * Completed receipts only renew ownership; first effects additionally validate
 * all read results and the lease inside their native atomic write batch.
 */
export async function d1AssistantSourceChecks(database: D1Store, actor: AssistantProofActor, kind: AssistantConfirmationKind, guard: AssistantSourceGuard) {
  if (!guard.d1 || guard.d1.kind !== kind) throw new AssistantSourceRefused()
  const payload = readAssistantSourceProof(guard.d1.token, actor, kind)
  if (!isAssistantConfirmationEnabled()) throw new AssistantSourceRefused()
  const input = { ...actor, serverNow: new Date(payload.issuedAt), localNow: new Date(payload.issuedAt),
    viewerTimeZone: payload.timeZone, surface: 'person' as const, materializeSeries: false }
  try {
    const capture = await captureD1Reads(async db => {
      const current = await db.user.findUnique({ where: { id: actor.userId }, select: { family_id: true, role: true, token_version: true } })
      if (!current || current.family_id !== actor.familyId || current.role !== actor.role || current.token_version !== actor.generation)
        throw new AssistantSourceRefused()
      const family = await db.family.findUnique({ where: { id: actor.familyId }, select: { features: true } })
      let sources: AssistantSourceRow[] = []
      const context = await loadAssistantTodayFromReads(db as unknown as AssistantTodayDb, { ...input, onSources(rows) { sources = rows } }, false)
      const snapshot = referenceAssistantToday(context, sources, input)
      if (!family || !snapshot || !assistantSourceSnapshotCurrent(payload, snapshot, family.features)) throw new AssistantSourceRefused()
      return snapshot
    }, database as unknown as NativeD1)
    const end = assistantSourceLeaseEnd(payload)
    return {
      checks(db: Pick<D1Store, 'prepare'>) {
        if (!isAssistantConfirmationEnabled() || Date.now() >= end) throw new AssistantSourceRefused()
        return [...capture.checks(db), d1WriteCheck(db,
          `(CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) >= ?1
          AND (CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)) < ?2`,
          [Date.parse(payload.issuedAt), end])]
      },
    }
  } catch { throw new AssistantSourceRefused() }
}
