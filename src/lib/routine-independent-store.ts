/** Independent routine adapter for the shared exact-request storage transitions. */
import {
  createOwnedRequestJournal,
  type OwnedRequestJournalOptions,
} from "@/lib/owned-request-journal";
import {
  independentRecoveryContext,
  independentRecoveryEntry,
  independentRecoveryJournal,
  independentEntryMatchesContext,
  INDEPENDENT_RECOVERY_CONTRACT,
  type IndependentRecoveryContext,
  type IndependentRecoveryEntry,
} from "@/lib/routine-independent-recovery";
type Options = Pick<
  OwnedRequestJournalOptions<
    IndependentRecoveryContext,
    IndependentRecoveryEntry
  >,
  "runtime" | "resolveContext" | "candidates" | "withLease" | "reviewRecovered"
>;
export function createIndependentRecoveryStore(options: Options) {
  return createOwnedRequestJournal({
    ...options,
    context: independentRecoveryContext,
    entry: independentRecoveryEntry,
    journal: independentRecoveryJournal,
    contract: INDEPENDENT_RECOVERY_CONTRACT,
    maxBytes: 2 * 1024 * 1024,
    matchesContext: independentEntryMatchesContext,
  });
}
