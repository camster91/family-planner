import { z } from "zod/mini";
import { todayLayoutSchema } from "@/lib/display-preferences-layout-schema";
import type { infer as ZodInfer } from "zod/mini";

/** The read receipt consumed by the dashboard preference provider. */
export const displaySnapshotSchema = z.strictObject({
  version: z.literal(1),
  revision: z.number().check(z.int(), z.gte(0)),
  defaultsRevision: z.number().check(z.int(), z.gte(0)),
  layout: z.strictObject({
    today: todayLayoutSchema,
    favorites: z.array(z.string()).check(z.maxLength(8)),
  }),
  quiet: z.boolean(),
  defaultToday: todayLayoutSchema,
  personalizedToday: z.boolean(),
  canManageDefaults: z.boolean(),
});

export type DisplaySnapshot = ZodInfer<typeof displaySnapshotSchema>;
