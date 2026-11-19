import { z } from "zod/mini";

/**
 * Stable identifiers are opaque to the member contract. Keep this small leaf
 * separate so client surfaces that only validate an event/profile reference do
 * not pull the complete member subject contract and its schema catalogue.
 */
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-id";
export { MEMBER_ID_PATTERN };
export const memberIdentityIdSchema = z
  .string()
  .check(z.regex(MEMBER_ID_PATTERN));
