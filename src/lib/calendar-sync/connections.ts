// Committing an OAuth callback into a CalendarConnection (#264).
//
// The household limit and the one-connection-per-member-per-provider rule
// are enforced here, atomically, under a per-household advisory lock. The
// check in the start route is only an early, friendly refusal: two flows
// started in parallel both pass it, and only this commit decides.

import { MAX_CONNECTIONS_PER_FAMILY } from "./sync";

export type CommitOutcome = "created" | "updated" | "no_refresh_token" | "limit";

export async function commitConnection(
  db: any,
  args: {
    familyId: string;
    userId: string;
    provider: string;
    /** Encrypted token fields, expiry and reset status; never plaintext. */
    data: Record<string, unknown>;
    hasRefreshToken: boolean;
  },
): Promise<CommitOutcome> {
  const { familyId, userId, provider, data } = args;
  const lockKey = `calsync-connections:${familyId}`;
  return db.$transaction(async (tx: any) => {
    // Serialises every commit for this household (released at commit).
    await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const existing = await tx.calendarConnection.findFirst({
      where: { family_id: familyId, user_id: userId, provider },
      select: { id: true, refresh_token_enc: true },
    });
    // Without a refresh token the connection would die within the hour.
    if (!args.hasRefreshToken && !existing?.refresh_token_enc)
      return "no_refresh_token";
    if (existing) {
      // Re-connect: new tokens, cursor reset, and a new generation so a sync
      // still running on the old grant cannot write its cursor back.
      await tx.calendarConnection.updateMany({
        where: { id: existing.id, family_id: familyId },
        data: { ...data, generation: { increment: 1 } },
      });
      return "updated";
    }
    const count = await tx.calendarConnection.count({
      where: { family_id: familyId },
    });
    if (count >= MAX_CONNECTIONS_PER_FAMILY) return "limit";
    await tx.calendarConnection.create({
      data: {
        family_id: familyId,
        user_id: userId,
        provider,
        generation: 0,
        ...data,
      },
    });
    return "created";
  });
}
