/**
 * Server-facing compatibility view of the queue owner contract.
 *
 * The canonical schema is Zod Mini so browser queue recovery does not load
 * classic Zod. Server contracts that still compose schemas with classic
 * methods use this pipe; it delegates validation to the same Mini contract
 * and preserves classic parse/error composition at their boundary.
 */
import { z } from "zod";
import { queueOwnerSchema, type QueueOwner } from "@/lib/queue-owner-contract";

export const queueOwnerClassicSchema = z.pipe(
  z.unknown(),
  queueOwnerSchema,
) as z.ZodType<QueueOwner>;
