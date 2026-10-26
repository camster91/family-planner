/** Bounded accepted account roster, shared by reward birth and claim producers.
 * No recipient discovery after source/receipt locks or on replay of a birth.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { NotificationEventActor } from "@/lib/notification-event-admission";
import { readPrivateNotificationDispatchWindow } from "@/lib/notification-event-policy";
import { lockRewardNotificationParticipants } from "@/lib/reward-notification-owner";
export type RewardNotificationRoster = { actor: NotificationEventActor; recipients: readonly string[]; windowMs: number };
type Audience = "parents" | "others";
const held = () => new Error("Reward notification roster held");
function where(familyId: string, userId: string, audience: Audience) {
  return { family_id: familyId, ...(audience === "parents" ? { role: "parent" } : { id: { not: userId } }) };
}
export async function prepareRewardNotificationRoster(
  db: Pick<PrismaClient, "$transaction">,
  original: { userId: string; familyId: string; role: string; tokenVersion?: number },
  audience: Audience, flag: string, window: string,
): Promise<RewardNotificationRoster | null> {
  const windowMs = readPrivateNotificationDispatchWindow(flag, window);
  if (windowMs === null) return null;
  const generation = original.tokenVersion;
  if (!Number.isSafeInteger(generation) || generation! < 0 || !["parent", "teen", "child"].includes(original.role)
      || (audience === "others" && original.role !== "parent")) throw held();
  const actor: NotificationEventActor = { userId: original.userId, familyId: original.familyId, role: original.role, tokenVersion: generation! };
  const recipients = await db.$transaction(async tx => {
    const person = await tx.user.findFirst({ where: { id: actor.userId, family_id: actor.familyId, role: actor.role, token_version: actor.tokenVersion }, select: { id: true } });
    if (!person) throw held();
    const rows = await tx.user.findMany({ where: where(actor.familyId, actor.userId, audience), select: { id: true }, orderBy: { id: "asc" }, take: 101 });
    if (rows.length > 100) throw held();
    return rows.map(row => row.id);
  }, { timeout: 5000, maxWait: 5000 });
  return { actor, recipients: Object.freeze(recipients), windowMs };
}
export async function lockRewardNotificationRoster(tx: Prisma.TransactionClient, plan: RewardNotificationRoster, audience: Audience) {
  const people = await lockRewardNotificationParticipants(tx, plan.actor, plan.recipients);
  const rows = await tx.user.findMany({ where: where(plan.actor.familyId, plan.actor.userId, audience), select: { id: true }, orderBy: { id: "asc" }, take: 101 });
  if (rows.length > 100 || JSON.stringify(rows.map(row => row.id)) !== JSON.stringify(plan.recipients)
      || plan.recipients.some(id => !people.some(person => person.id === id && person.family_id === plan.actor.familyId
        && (audience === "parents" ? person.role === "parent" : ["parent", "teen", "child"].includes(person.role))))) throw held();
}
