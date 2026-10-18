/** #557 dormant two-party owner verification. Never call from shared-device auth. */
import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { safeVerifyPassword } from "@/lib/auth";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { isValidIdempotencyKey } from "@/lib/idempotency-key";
import { hashIdempotentRequest } from "@/lib/idempotency";
import {
  profileLinkCommand,
  profileLinkReceipt,
  PROFILE_LINK_TTL_MS,
  type ProfileLinkReceipt,
} from "@/lib/profile-account-link-contract";

export class ProfileLinkError extends Error {
  constructor(
    public readonly code:
      | "INVALID"
      | "UNAUTHORIZED"
      | "FORBIDDEN"
      | "UNAVAILABLE"
      | "CONFLICT"
      | "REAUTH_REQUIRED",
  ) {
    super("The profile account link could not be completed.");
    this.name = "ProfileLinkError";
  }
}
type Actor = { userId: string; familyId: string; tokenVersion: number };
type Tx = Prisma.TransactionClient;
const knownRole = (role: string) =>
  role === "parent" || role === "teen" || role === "child";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const accountSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  family_id: true,
  token_version: true,
  email_verified: true,
} as const;
const profileSelect = {
  id: true,
  name: true,
  role: true,
  family_id: true,
  revision: true,
  archived_at: true,
  erasure_user_id: true,
  legacy_mapping: true,
  account_link: true,
} as const;
type Challenge = Prisma.HouseholdProfileLinkChallengeGetPayload<
  Record<string, never>
>;
type Profile = Prisma.HouseholdMemberGetPayload<{
  select: typeof profileSelect;
}>;
type Account = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

function usableProfile(profile: Profile | null): asserts profile is Profile {
  if (
    !profile ||
    profile.archived_at ||
    profile.erasure_user_id ||
    !knownRole(profile.role)
  )
    throw new ProfileLinkError("UNAVAILABLE");
}
function unlinked(profile: Profile) {
  if (profile.legacy_mapping || profile.account_link)
    throw new ProfileLinkError("CONFLICT");
}
function currentAccount(
  account: Account | null,
  actor: Actor,
): asserts account is Account {
  if (!account || account.token_version !== actor.tokenVersion)
    throw new ProfileLinkError("UNAUTHORIZED");
  if (account.family_id !== actor.familyId || !knownRole(account.role))
    throw new ProfileLinkError("FORBIDDEN");
}
function receipt(
  challenge: Challenge,
  profile: Profile,
  account: Account | null,
  state = challenge.state,
): ProfileLinkReceipt {
  return profileLinkReceipt.parse({
    id: challenge.id,
    memberId: profile.id,
    profileName: profile.name,
    profileRole: profile.role,
    account:
      account && knownRole(account.role)
        ? {
            id: account.id,
            name: account.name,
            email: account.email,
            role: account.role,
          }
        : null,
    state,
    revision: challenge.revision,
    expiresAt: challenge.expires_at.toISOString(),
  });
}
async function targetAvailable(tx: Tx, user: Account, profile: Profile) {
  if (
    user.family_id !== profile.family_id ||
    !user.email_verified ||
    user.role !== profile.role
  )
    throw new ProfileLinkError("CONFLICT");
  const [mapping, link] = await Promise.all([
    tx.householdMemberLegacyMapping.findUnique({ where: { user_id: user.id } }),
    tx.householdMemberAccountLink.findUnique({ where: { user_id: user.id } }),
  ]);
  // Another stable person cannot be silently merged into this one.
  if (mapping || link) throw new ProfileLinkError("CONFLICT");
}

/**
 * Keep both subject aliases in one transaction. IDs, recurrence, status, actors,
 * points, XP and account authority are unchanged. In particular linking does not
 * turn a profile completion into an account completion or award historic credit.
 */
async function attachSubjects(
  tx: Tx,
  profile: Profile,
  account: Account,
  now: Date,
) {
  const incompatible = {
    OR: [
      { assigned_member_id: profile.id, assigned_to: { not: account.id } },
      { assigned_to: account.id, assigned_member_id: { not: profile.id } },
      { assigned_to: account.id, family_id: { not: profile.family_id } },
    ],
  };
  // Prisma's nullable `not` deliberately ignores NULL. Those are the aliases
  // this transaction fills; a sticky erasure marker is never reconstructed.
  const [chores, assignments] = await Promise.all([
    tx.chore.count({ where: incompatible }),
    tx.choreAssignment.count({ where: incompatible }),
  ]);
  if (chores || assignments) throw new ProfileLinkError("CONFLICT");
  await tx.householdMemberLegacyMapping.create({
    data: {
      user_id: account.id,
      member_id: profile.id,
      family_id: profile.family_id,
    },
  });
  await tx.householdMemberAccountLink.create({
    data: {
      user_id: account.id,
      member_id: profile.id,
      family_id: profile.family_id,
      verified_at: now,
    },
  });
  await tx.chore.updateMany({
    where: {
      family_id: profile.family_id,
      assigned_member_id: profile.id,
      assigned_to: null,
      member_subject_erased: false,
    },
    data: { assigned_to: account.id },
  });
  await tx.chore.updateMany({
    where: {
      family_id: profile.family_id,
      assigned_to: account.id,
      assigned_member_id: null,
      member_subject_erased: false,
    },
    data: { assigned_member_id: profile.id },
  });
  await tx.choreAssignment.updateMany({
    where: {
      family_id: profile.family_id,
      assigned_to: account.id,
      assigned_member_id: null,
      member_subject_erased: false,
    },
    data: { assigned_member_id: profile.id },
  });
  await tx.householdMember.update({
    where: { id: profile.id },
    data: { revision: { increment: 1 } },
  });
}

export async function manageProfileAccountLink(
  db: Pick<PrismaClient, "$transaction" | "user">,
  actor: Actor,
  input: unknown,
  clock: () => Date = () => new Date(),
): Promise<{ links: ProfileLinkReceipt[] }> {
  const parsed = profileLinkCommand.safeParse(input);
  if (!parsed.success) throw new ProfileLinkError("INVALID");
  const command = parsed.data;
  if (command.action === "issue" && !isValidIdempotencyKey(command.key))
    throw new ProfileLinkError("INVALID");
  // Password work is outside the lifecycle locks. Recheck the exact hash and
  // session generation under those locks before consuming ownership proof.
  let passwordHash: string | null = null;
  if (command.action === "claim") {
    const owner = await db.user.findUnique({
      where: { id: actor.userId },
      select: { password: true },
    });
    passwordHash = owner?.password ?? null;
    if (
      !(await safeVerifyPassword(command.password, passwordHash)) ||
      !passwordHash
    )
      throw new ProfileLinkError("REAUTH_REQUIRED");
  }
  return db.$transaction(async (tx) => {
    // Discover participants before acquiring any locks. Re-read after locking;
    // if a claimant arrived meanwhile, return conflict instead of reversing the
    // universal User -> household acquisition order.
    const discovered =
      command.action === "list" || command.action === "issue"
        ? null
        : await tx.householdProfileLinkChallenge.findUnique({
            where:
              "token" in command
                ? { token_hash: digest(command.token) }
                : { id: command.id },
          });
    if (
      command.action !== "list" &&
      command.action !== "issue" &&
      (!discovered || discovered.family_id !== actor.familyId)
    )
      throw new ProfileLinkError("UNAVAILABLE");
    const ids = [
      ...new Set(
        [actor.userId, discovered?.issued_by, discovered?.claimed_by].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ].sort();
    for (const id of ids) await lockUser(tx, id);
    await lockHousehold(tx, actor.familyId);
    // Expiry is evaluated after lock waits/password work, never against the
    // potentially much earlier request-start timestamp.
    const now = clock();
    const viewer = await tx.user.findUnique({
      where: { id: actor.userId },
      select: accountSelect,
    });
    currentAccount(viewer, actor);
    if (
      !(await tx.family.findUnique({
        where: { id: actor.familyId },
        select: { id: true },
      }))
    )
      throw new ProfileLinkError("UNAVAILABLE");
    if (
      ["issue", "list", "approve", "revoke"].includes(command.action) &&
      viewer.role !== "parent"
    )
      throw new ProfileLinkError("FORBIDDEN");

    if (command.action === "list") {
      // At most one outstanding row per profile; show the complete household
      // roster's attempts so older owners are not silently hidden by a cap.
      const rows = await tx.householdProfileLinkChallenge.findMany({
        where: {
          family_id: actor.familyId,
          state: { in: ["pending", "claimed"] },
        },
        orderBy: { created_at: "desc" },
      });
      const links: ProfileLinkReceipt[] = [];
      for (const row of rows) {
        const profile = await tx.householdMember.findUnique({
          where: { id: row.member_id },
          select: profileSelect,
        });
        if (!profile || !knownRole(profile.role)) continue;
        const account = row.claimed_by
          ? await tx.user.findUnique({
              where: { id: row.claimed_by },
              select: accountSelect,
            })
          : null;
        const issuer = await tx.user.findUnique({
          where: { id: row.issued_by },
          select: accountSelect,
        });
        const unavailable =
          profile.archived_at ||
          profile.erasure_user_id ||
          profile.revision !== row.profile_revision ||
          profile.account_link ||
          profile.legacy_mapping ||
          issuer?.family_id !== actor.familyId ||
          issuer.role !== "parent" ||
          issuer.token_version !== row.issued_token_version ||
          (row.claimed_by &&
            (account?.family_id !== actor.familyId ||
              account.token_version !== row.claimed_token_version ||
              !account.email_verified ||
              account.role !== profile.role));
        links.push(
          receipt(
            row,
            profile,
            account?.family_id === actor.familyId ? account : null,
            unavailable
              ? "unavailable"
              : row.expires_at <= now
                ? "expired"
                : row.state,
          ),
        );
      }
      return { links };
    }
    if (command.action === "issue") {
      const id = `hpl_${digest(JSON.stringify([actor.familyId, actor.userId, command.key]))}`;
      const tokenHash = digest(command.token);
      const requestHash = hashIdempotentRequest("profile-account-link.issue", {
        memberId: command.memberId,
        revision: command.revision,
        tokenHash,
      });
      const prior = await tx.householdProfileLinkChallenge.findUnique({
        where: { id },
      });
      const profile = await tx.householdMember.findUnique({
        where: { id: command.memberId },
        select: profileSelect,
      });
      usableProfile(profile);
      if (profile.family_id !== actor.familyId)
        throw new ProfileLinkError("UNAVAILABLE");
      if (prior) {
        if (
          prior.request_hash !== requestHash ||
          prior.family_id !== actor.familyId ||
          prior.issued_by !== actor.userId ||
          prior.issued_token_version !== actor.tokenVersion
        )
          throw new ProfileLinkError("CONFLICT");
        unlinked(profile);
        if (
          profile.revision !== command.revision ||
          prior.expires_at <= now ||
          !["pending", "claimed"].includes(prior.state)
        )
          throw new ProfileLinkError("UNAVAILABLE");
        const account = prior.claimed_by
          ? await tx.user.findUnique({
              where: { id: prior.claimed_by },
              select: accountSelect,
            })
          : null;
        return {
          links: [
            receipt(
              prior,
              profile,
              account?.family_id === actor.familyId ? account : null,
            ),
          ],
        };
      }
      unlinked(profile);
      if (profile.revision !== command.revision)
        throw new ProfileLinkError("CONFLICT");
      // No scheduler: an explicit new issuance closes expired attempts under
      // the same household lock, then the partial unique index protects races.
      await tx.householdProfileLinkChallenge.updateMany({
        where: {
          member_id: profile.id,
          family_id: actor.familyId,
          state: { in: ["pending", "claimed"] },
          expires_at: { lte: now },
        },
        data: { state: "revoked", revision: { increment: 1 } },
      });
      if (
        await tx.householdProfileLinkChallenge.findFirst({
          where: {
            member_id: profile.id,
            state: { in: ["pending", "claimed"] },
          },
        })
      )
        throw new ProfileLinkError("CONFLICT");
      const created = await tx.householdProfileLinkChallenge.create({
        data: {
          id,
          family_id: actor.familyId,
          member_id: profile.id,
          issued_by: actor.userId,
          issued_token_version: actor.tokenVersion,
          profile_revision: profile.revision,
          token_hash: tokenHash,
          request_hash: requestHash,
          expires_at: new Date(now.getTime() + PROFILE_LINK_TTL_MS),
        },
      });
      return { links: [receipt(created, profile, null)] };
    }

    const row = await tx.householdProfileLinkChallenge.findUnique({
      where: { id: discovered!.id },
    });
    if (
      !row ||
      row.family_id !== actor.familyId ||
      row.issued_by !== discovered!.issued_by ||
      row.claimed_by !== discovered!.claimed_by
    )
      throw new ProfileLinkError("CONFLICT");
    const profile = await tx.householdMember.findUnique({
      where: { id: row.member_id },
      select: profileSelect,
    });
    if (
      !profile ||
      profile.family_id !== actor.familyId ||
      !knownRole(profile.role)
    )
      throw new ProfileLinkError("UNAVAILABLE");
    // Revocation remains possible when the issuer has lost authority or the
    // profile changed. A completed identity uses the existing removal lifecycle.
    if (command.action === "revoke") {
      if (row.state === "revoked")
        return { links: [receipt(row, profile, null)] };
      if (row.state === "linked" || row.revision !== command.revision)
        throw new ProfileLinkError("CONFLICT");
      const revoked = await tx.householdProfileLinkChallenge.update({
        where: { id: row.id },
        data: { state: "revoked", revision: { increment: 1 } },
      });
      return { links: [receipt(revoked, profile, null)] };
    }
    usableProfile(profile);
    const issuer = await tx.user.findUnique({
      where: { id: row.issued_by },
      select: accountSelect,
    });
    if (
      !issuer ||
      issuer.family_id !== actor.familyId ||
      issuer.role !== "parent" ||
      issuer.token_version !== row.issued_token_version
    )
      throw new ProfileLinkError("UNAVAILABLE");
    const target = row.claimed_by
      ? await tx.user.findUnique({
          where: { id: row.claimed_by },
          select: accountSelect,
        })
      : null;
    if (row.state === "linked") {
      if (command.action === "approve" && command.revision !== row.revision - 1)
        throw new ProfileLinkError("CONFLICT");
      // Lost-response receipt only; never recreate a link after removal/erasure.
      if (
        command.action !== "approve" ||
        !target ||
        target.family_id !== actor.familyId ||
        target.token_version !== row.claimed_token_version ||
        !target.email_verified ||
        target.role !== profile.role ||
        profile.account_link?.user_id !== target.id ||
        profile.legacy_mapping?.user_id !== target.id
      )
        throw new ProfileLinkError("UNAVAILABLE");
      return { links: [receipt(row, profile, target)] };
    }
    if (
      row.expires_at <= now ||
      row.state === "revoked" ||
      profile.revision !== row.profile_revision
    )
      throw new ProfileLinkError("UNAVAILABLE");
    unlinked(profile);
    if (command.action === "preview" || command.action === "claim") {
      if (row.claimed_by && row.claimed_by !== actor.userId)
        throw new ProfileLinkError("UNAVAILABLE");
      await targetAvailable(tx, viewer, profile);
      if (row.claimed_by && row.claimed_token_version !== actor.tokenVersion)
        throw new ProfileLinkError("UNAVAILABLE");
      if (command.action === "preview")
        return { links: [receipt(row, profile, viewer)] };
      const proof = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { password: true },
      });
      if (proof?.password !== passwordHash)
        throw new ProfileLinkError("REAUTH_REQUIRED");
      if (row.state === "claimed")
        return { links: [receipt(row, profile, viewer)] };
      const claimed = await tx.householdProfileLinkChallenge.update({
        where: { id: row.id },
        data: {
          state: "claimed",
          claimed_by: actor.userId,
          claimed_token_version: actor.tokenVersion,
          claimed_at: now,
          revision: { increment: 1 },
        },
      });
      return { links: [receipt(claimed, profile, viewer)] };
    }
    if (
      command.action !== "approve" ||
      row.state !== "claimed" ||
      row.revision !== command.revision ||
      !target ||
      target.token_version !== row.claimed_token_version
    )
      throw new ProfileLinkError("CONFLICT");
    await targetAvailable(tx, target, profile);
    await attachSubjects(tx, profile, target, now);
    const linked = await tx.householdProfileLinkChallenge.update({
      where: { id: row.id },
      data: { state: "linked", linked_at: now, revision: { increment: 1 } },
    });
    await tx.activity.create({
      data: {
        family_id: actor.familyId,
        user_id: actor.userId,
        subject_member_id: profile.id,
        type: "profile_account_linked",
        title: "Household profile linked to an account",
      },
    });
    return { links: [receipt(linked, profile, target)] };
  });
}
