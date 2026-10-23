import { array, boolean, literal, number, object, string } from "zod/v4";
import { todayLayoutSchema } from "@/lib/display-preferences-layout-schema";
import type { infer as ZodInfer } from "zod/v4";

/** The read receipt consumed by the dashboard preference provider. */
export const displaySnapshotSchema = object({
  version: literal(1),
  revision: number().int().min(0),
  defaultsRevision: number().int().min(0),
  layout: object({
    today: todayLayoutSchema,
    favorites: array(string()).max(8),
  }).strict(),
  quiet: boolean(),
  defaultToday: todayLayoutSchema,
  personalizedToday: boolean(),
  canManageDefaults: boolean(),
}).strict();

export type DisplaySnapshot = ZodInfer<typeof displaySnapshotSchema>;
