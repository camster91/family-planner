/** #480 internal command core. No route/client activation until domain/capability migration. */
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { hashIdempotentRequest, IDEMPOTENCY_TTL_MS } from "@/lib/idempotency";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";

const name = z.string().trim().min(1).max(100);
const age = z.number().int().min(0).max(17).nullable().optional();
const target = {
  id: z.string().min(1).max(128),
  revision: z.number().int().nonnegative(),
};
export const householdProfileCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name, age }).strict(),
  z.object({ action: z.literal("edit"), ...target, name, age }).strict(),
  z.object({ action: z.literal("archive"), ...target }).strict(),
]);
const display = {
  id: true,
  family_id: true,
  name: true,
  role: true,
  age: true,
  archived_at: true,
  revision: true,
} as const;
const publicProfile = z
  .object({
    id: z.string(),
    family_id: z.string(),
    name: z.string(),
    role: z.literal("child"),
    age: z.number().int().nullable(),
    archived_at: z.string().nullable(),
    revision: z.number().int(),
  })
  .strict();
export type PublicChildProfile = z.infer<typeof publicProfile>;

export class HouseholdProfileError extends Error {
  constructor(
    public readonly code:
      | "INVALID"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "CONFLICT"
      | "KEY_REUSED",
  ) {
    super("The household profile change could not be applied.");
    this.name = "HouseholdProfileError";
  }
}

/** Real personal session context only; a selected shared profile cannot supply authority. */
export async function manageHouseholdProfile(
  db: Pick<PrismaClient, "$transaction">,
  actor: { userId: string; familyId: string; tokenVersion: number },
  key: string,
  input: unknown,
  now = new Date(),
) {
  const parsed = householdProfileCommand.safeParse(input);
  if (!parsed.success || !isValidIdempotencyKey(key))
    throw new HouseholdProfileError("INVALID");
  const command = parsed.data;
  const action = `household-profile.${command.action}`;
  const requestHash = hashIdempotentRequest(action, command);
  const scope = `user:${actor.userId}`;
  return db.$transaction(async (tx) => {
    await lockUser(tx, actor.userId);
    await lockHousehold(tx, actor.familyId);
    const account = await tx.user.findUnique({
      where: { id: actor.userId },
      select: { family_id: true, role: true, token_version: true },
    });
    if (!account || account.token_version !== actor.tokenVersion)
      throw new HouseholdProfileError("UNAUTHORIZED");
    if (account.family_id !== actor.familyId || account.role !== "parent")
      throw new HouseholdProfileError("FORBIDDEN");
    if (
      !(await tx.family.findUnique({
        where: { id: actor.familyId },
        select: { id: true },
      }))
    )
      throw new HouseholdProfileError("NOT_FOUND");

    const prior = await tx.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (prior) {
      if (
        prior.family_id !== actor.familyId ||
        prior.action !== action ||
        prior.request_hash !== requestHash
      )
        throw new HouseholdProfileError("KEY_REUSED");
      if (
        prior.expires_at > now &&
        prior.response_status === 200 &&
        prior.response_body !== null
      ) {
        const saved = publicProfile.safeParse(prior.response_body);
        if (!saved.success || saved.data.family_id !== actor.familyId)
          throw new HouseholdProfileError("CONFLICT");
        return { profile: saved.data, replayed: true };
      }
      if (prior.expires_at > now) throw new HouseholdProfileError("CONFLICT");
      await tx.idempotencyRecord.delete({ where: { id: prior.id } });
    }

    let profile;
    if (command.action === "create") {
      // Stable identity also prevents a late retry from creating another person
      // after the shared idempotency retention has expired. Never adopt collisions.
      const id = `hm_${createHash("sha256")
        .update(JSON.stringify([actor.familyId, actor.userId, key]))
        .digest("hex")}`;
      if (
        await tx.householdMember.findUnique({
          where: { id },
          select: { id: true },
        })
      )
        throw new HouseholdProfileError("CONFLICT");
      profile = await tx.householdMember.create({
        data: {
          id,
          family_id: actor.familyId,
          name: command.name,
          age: command.age ?? null,
          role: "child",
        },
        select: display,
      });
    } else {
      const member = await tx.householdMember.findFirst({
        where: { id: command.id, family_id: actor.familyId },
        select: {
          ...display,
          erasure_user_id: true,
          legacy_mapping: { select: { user_id: true } },
          account_link: { select: { user_id: true } },
        },
      });
      if (!member) throw new HouseholdProfileError("NOT_FOUND");
      // This command owns name-only children; linked/mapped accounts retain their
      // reviewed account lifecycle. No implicit account edits or unlinking.
      if (
        member.role !== "child" ||
        member.legacy_mapping ||
        member.account_link ||
        member.erasure_user_id ||
        member.archived_at ||
        member.revision !== command.revision
      )
        throw new HouseholdProfileError("CONFLICT");
      profile = await tx.householdMember.update({
        where: { id: member.id },
        data:
          command.action === "archive"
            ? { archived_at: now, revision: { increment: 1 } }
            : {
                name: command.name,
                ...(command.age !== undefined ? { age: command.age } : {}),
                revision: { increment: 1 },
              },
        select: display,
      });
    }
    // Effect and replay record commit together. No mailbox, account, session,
    // invitation, link, scheduler or credential is created by these commands.
    const response = publicProfile.parse(JSON.parse(JSON.stringify(profile)));
    await tx.idempotencyRecord.create({
      data: {
        scope,
        key,
        family_id: actor.familyId,
        user_id: actor.userId,
        action,
        request_hash: requestHash,
        response_status: 200,
        response_body: response,
        created_at: now,
        expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      },
    });
    return { profile: response, replayed: false };
  });
}
