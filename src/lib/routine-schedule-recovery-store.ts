/** Routine adapter for the shared exact-request storage transitions. */
import {
  createOwnedRequestJournal,
  type OwnedRequestJournalOptions,
} from "@/lib/owned-request-journal";
import {
  routineRecoveryContext,
  routineRecoveryEntry,
  routineRecoveryJournal,
  routineEntryMatchesContext,
  ROUTINE_RECOVERY_CONTRACT,
  ROUTINE_RECOVERY_MAX_BYTES,
  type RoutineRecoveryContext,
  type RoutineRecoveryEntry,
} from "@/lib/routine-schedule-recovery-contract";
type Options = Pick<
  OwnedRequestJournalOptions<RoutineRecoveryContext, RoutineRecoveryEntry>,
  "runtime" | "resolveContext" | "candidates" | "withLease" | "reviewRecovered"
>;
export function createRoutineRecoveryStore(options: Options) {
  return createOwnedRequestJournal({
    ...options,
    context: routineRecoveryContext,
    entry: routineRecoveryEntry,
    journal: routineRecoveryJournal,
    contract: ROUTINE_RECOVERY_CONTRACT,
    maxBytes: ROUTINE_RECOVERY_MAX_BYTES,
    matchesContext: routineEntryMatchesContext,
  });
}
