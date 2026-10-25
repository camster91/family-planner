/** Thin note adapter for the existing owned CAS journal; never a second queue. */
import { createOwnedRequestJournal, type OwnedRequestJournalOptions } from "./owned-request-journal";
import { NOTE_CREATE_RECOVERY_CONTRACT } from "./note-create-recovery-identity";
import { noteRecoveryContext, noteRecoveryEntry, noteRecoveryJournal, noteEntryMatchesContext,
  type NoteRecoveryContext, type NoteRecoveryEntry } from "./note-create-recovery-contract";
type Options = Pick<OwnedRequestJournalOptions<NoteRecoveryContext, NoteRecoveryEntry>,
  "runtime" | "resolveContext" | "candidates" | "withLease" | "reviewRecovered">;
export function createNoteRecoveryStore(options: Options) {
  return createOwnedRequestJournal({ ...options, context: noteRecoveryContext, entry: noteRecoveryEntry,
    journal: noteRecoveryJournal, contract: NOTE_CREATE_RECOVERY_CONTRACT, maxBytes: 96 * 1024,
    matchesContext: noteEntryMatchesContext, reviewBeforeEverySend: true });
}
