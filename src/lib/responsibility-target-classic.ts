/** Server compatibility view for the browser-safe responsibility target. */
import { z } from "zod";
import {
  responsibilityTarget as miniResponsibilityTarget,
  type ResponsibilityTarget,
} from "@/lib/responsibility-target";

export const responsibilityTargetClassic = z.pipe(
  z.unknown(),
  miniResponsibilityTarget,
) as z.ZodType<ResponsibilityTarget>;
