import { loadAssistantTodayFromReads, type AssistantTodayDb, type LoadAssistantTodayContextInput } from '@/lib/assistant-today-context'
import { withD1ReadClient } from './read-client'

/** Compatibility is limited to this loader's source-owned read projections:
 * no scalar-array predicates, raw SQL, mutations or transaction callbacks.
 * The D1 facade also enforces that read-only boundary at runtime. PostgreSQL
 * delegate types differ in unrelated model fields that this loader never reads.
 * Native Worker fixtures cover all six selected domains and nested projections.
 */
export async function loadD1AssistantTodayContext(input: LoadAssistantTodayContextInput, database?: Parameters<typeof withD1ReadClient>[1]) {
  return withD1ReadClient(db => loadAssistantTodayFromReads(db as unknown as AssistantTodayDb, input, false), database)
}
