/** Read-only change projections. Never a mutation journal or permission token. */
import { z } from "zod";
import { AUDIT_ACTIONS } from "@/lib/household-audit-contract";
import { memberIdentityIdSchema as id } from "@/lib/member-subject-contract";
export const PRIVATE_TIMELINE_ACTIONS = [
  "chore_created",
  "recipe_created",
  "preparation_changed",
  "preparation_routine_copied",
  "schedule_changed",
  "responsibility_changed",
] as const;
export const COORDINATION_ACTIONS = [
  "event_created",
  "chore_completed",
  "chore_verified",
  "chore_rejected",
  ...PRIVATE_TIMELINE_ACTIONS,
] as const;
export const timelineAction = z.enum([
  ...AUDIT_ACTIONS,
  ...COORDINATION_ACTIONS,
]);
export type TimelineAction = z.infer<typeof timelineAction>;
export const timelineSource = z.enum(["all", "coordination", "settings"]);
export const timelineQuery = z
  .object({
    source: timelineSource.default("all"),
    cursor: z.string().min(1).max(400).optional(),
  })
  .strict();
export const timelineTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), id }).strict(),
  z.object({ kind: z.literal("chore"), id }).strict(),
  z.object({ kind: z.literal("handoff"), id }).strict(),
  z.object({ kind: z.literal("pickup"), id }).strict(),
  z.object({ kind: z.literal("recipe"), id }).strict(),
  z.object({ kind: z.literal("settings") }).strict(),
]);
export const timelineOrigin = z.enum([
  "app",
  "settings",
  "preparation",
  "schedule",
  "responsibility",
  "recipes",
]);
export const timelinePage = z
  .object({
    owner: z
      .object({
        userId: id,
        familyId: id,
        generation: z.number().int().nonnegative(),
      })
      .strict(),
    source: timelineSource,
    entries: z
      .array(
        z
          .object({
            id: z.string().min(1).max(150),
            action: timelineAction,
            at: z.string().datetime(),
            actor: z
              .object({
                name: z.string().max(80).nullable(),
                kind: z.enum(["person", "tablet", "unknown"]),
              })
              .strict(),
            origin: timelineOrigin,
            target: timelineTarget.nullable(),
            featureKey: z.string().max(40).nullable(),
            title: z.string().max(200).nullable(),
            current: z.enum(["available", "unavailable", "unknown"]),
          })
          .strict(),
      )
      .max(20),
    nextCursor: z.string().min(1).max(400).nullable(),
  })
  .strict();
export type TimelinePage = z.infer<typeof timelinePage>;
export type TimelineTarget = z.infer<typeof timelineTarget>;
/** Constructed from a verified target, never a saved/provider URL. Every
 * destination renews its canonical authority and owns its supported reversals. */
export function timelineHref(target: TimelineTarget): string {
  switch (target.kind) {
    case "event":
      return `/dashboard/calendar/edit?id=${encodeURIComponent(target.id)}`;
    case "chore":
      return `/dashboard/chores/edit?id=${encodeURIComponent(target.id)}`;
    case "recipe":
      return `/dashboard/meals/recipes/${encodeURIComponent(target.id)}`;
    case "pickup":
      return `/dashboard/review?source=changes&responsibilityKind=pickup&responsibilityId=${encodeURIComponent(target.id)}`;
    case "handoff":
      return `/dashboard/review?source=changes&responsibilityKind=handoff&responsibilityId=${encodeURIComponent(target.id)}`;
    case "settings":
      return "/dashboard/settings/activity";
  }
}
