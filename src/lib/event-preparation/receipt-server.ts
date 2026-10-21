/** Node-only adapter; never import idempotency/Next server code in a browser. */
import { hashIdempotentRequest } from "@/lib/idempotency";
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
