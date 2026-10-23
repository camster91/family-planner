/** Shared canonical input; review documents preserve the original encoded body. */
import { z } from "zod";
export const captureGrocerySchema = z.object({
  content: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(9999).default(1),
});
