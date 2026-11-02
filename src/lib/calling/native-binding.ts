import { z } from "zod";
import type { D1Store } from "@/lib/cloudflare/database";

export const nativeCallBindingSchema = z
  .object({
    installationId: z.string().uuid(),
    epoch: z.string().uuid(),
    revision: z.number().int().positive().safe(),
    owner: z
      .object({
        userId: z.string().min(1).max(128),
        familyId: z.string().min(1).max(128),
        generation: z.number().int().nonnegative().safe(),
      })
      .strict(),
  })
  .strict();
export type NativeCallBinding = z.infer<typeof nativeCallBindingSchema>;

/** Server-only, primary D1 read shared by the room and wake dispatcher. */
export async function readCurrentAndroidBinding(
  db: D1Store,
  binding: NativeCallBinding,
  now = Date.now(),
) {
  if (!nativeCallBindingSchema.safeParse(binding).success) return null;
  return db
    .withSession("first-primary")
    .prepare(
      `SELECT i.push_token_enc,i.label FROM "NativeCallInstallation" i
     JOIN "User" u ON u.id=i.user_id AND u.family_id=i.family_id AND u.token_version=i.generation
     JOIN "Family" f ON f.id=i.family_id
     WHERE i.id=? AND i.user_id=? AND i.family_id=? AND i.generation=?
     AND i.epoch=? AND i.revision=? AND i.platform='android' AND i.provider='fcm'
     AND i.revoked_at IS NULL AND i.expires_at>? AND i.push_token_enc IS NOT NULL
     AND u.role IN ('parent','teen','child') AND json_extract(f.features,'$.calling')=1`,
    )
    .bind(
      binding.installationId,
      binding.owner.userId,
      binding.owner.familyId,
      binding.owner.generation,
      binding.epoch,
      binding.revision,
      now,
    )
    .first<{ push_token_enc: string; label: string }>();
}

export function sameNativeBinding(a: NativeCallBinding, b: NativeCallBinding) {
  return (
    a.installationId === b.installationId &&
    a.epoch === b.epoch &&
    a.revision === b.revision &&
    a.owner.userId === b.owner.userId &&
    a.owner.familyId === b.owner.familyId &&
    a.owner.generation === b.owner.generation
  );
}
