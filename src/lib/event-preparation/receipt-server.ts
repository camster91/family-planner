/** Server-side receipt hashing, shared by Node and native Workers. */
import { hashIdempotentRequest } from "@/lib/idempotency-hash";
import type { PreparationCommand } from "./contract";
import {
  preparationReceiptMatches as matches,
  PREPARATION_ACTION,
} from "./http";
export function preparationReceiptMatches(
  raw: unknown,
  command: PreparationCommand,
  key: string,
) {
  return matches(
    raw,
    command,
    key,
    hashIdempotentRequest(PREPARATION_ACTION, command),
  );
}
