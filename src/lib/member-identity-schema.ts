import { z } from "zod/mini";

/**
 * Stable identifiers are opaque to the member contract. Keep this small leaf
 * separate so client surfaces that only validate an event/profile reference do
 * not pull the complete member subject contract and its schema catalogue.
 */
export const MEMBER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const memberIdentityIdSchema = z
  .string()
  .check(z.regex(MEMBER_ID_PATTERN));
