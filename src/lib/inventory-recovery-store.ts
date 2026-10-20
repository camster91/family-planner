/** Inventory adapter for the shared owned exact-request journal. */
import {
  createOwnedRequestJournal,
  OwnedRequestRecoveryError,
  type OwnedRequestJournalOptions,
} from "@/lib/owned-request-journal";
import {
  INVENTORY_RECOVERY_CONTRACT,
  INVENTORY_RECOVERY_MAX_BYTES,
  inventoryRecoveryContext,
  inventoryRecoveryEntry,
  inventoryRecoveryJournal,
  inventoryEntryMatchesContext,
  type InventoryRecoveryContext,
  type InventoryRecoveryEntry,
} from "@/lib/inventory-recovery-contract";
export class InventoryRecoveryError extends OwnedRequestRecoveryError {
  constructor(reason: OwnedRequestRecoveryError["reason"]) {
    super(reason);
    this.name = "InventoryRecoveryError";
  }
}
type Options = Pick<
  OwnedRequestJournalOptions<InventoryRecoveryContext, InventoryRecoveryEntry>,
  "runtime" | "resolveContext" | "candidates" | "withLease" | "reviewRecovered"
>;
export function createInventoryRecoveryStore(options: Options) {
  return createOwnedRequestJournal({
    ...options,
    context: inventoryRecoveryContext,
    entry: inventoryRecoveryEntry,
    journal: inventoryRecoveryJournal,
    contract: INVENTORY_RECOVERY_CONTRACT,
    maxBytes: INVENTORY_RECOVERY_MAX_BYTES,
    matchesContext: inventoryEntryMatchesContext,
    error: (reason) => new InventoryRecoveryError(reason),
  });
}
