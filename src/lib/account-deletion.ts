import { prisma } from "@/lib/prisma";

export class LastParentError extends Error {
  constructor() {
    super("Deleting the final parent requires explicit whole-family deletion");
  }
}

export async function deleteAccountData(userId: string, deleteFamily = false) {
  if (!prisma) throw new Error("Database is not configured");

  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, family_id: true },
      });
      if (!user) return { deleted: false, mode: "missing" as const };

      if (!user.family_id) {
        await tx.user.delete({ where: { id: user.id } });
        return { deleted: true, mode: "account" as const };
      }

      const familyId = user.family_id;
      const successor = await tx.user.findFirst({
        where: { family_id: familyId, role: "parent", id: { not: user.id } },
        select: { id: true },
        orderBy: { created_at: "asc" },
      });

      if (user.role === "parent" && !successor) {
        if (!deleteFamily) throw new LastParentError();
        const members = await tx.user.findMany({
          where: { family_id: familyId },
          select: { id: true },
        });
        await tx.family.delete({ where: { id: familyId } });
        await tx.user.deleteMany({
          where: { id: { in: members.map((member) => member.id) } },
        });
        return { deleted: true, mode: "family" as const };
      }

      if (!successor) throw new LastParentError();
      const successorId = successor.id;

      await tx.auditLog.create({
        data: {
          family_id: familyId,
          actor_id: null,
          action: "account.deleted",
          resource_type: "User",
          resource_id: null,
          metadata: {
            role: user.role,
            sharedOwnershipTransferredTo: successorId,
          },
        },
      });

      const [
        assignmentIds,
        habitLogIds,
        badgeIds,
        redemptionIds,
        wishlistIds,
        transactionIds,
      ] = await Promise.all([
        tx.choreAssignment.findMany({
          where: { assigned_to: user.id },
          select: { id: true },
        }),
        tx.habitLog.findMany({
          where: { user_id: user.id },
          select: { id: true },
        }),
        tx.earnedBadge.findMany({
          where: { user_id: user.id },
          select: { id: true },
        }),
        tx.rewardRedemption.findMany({
          where: { requested_by: user.id },
          select: { id: true },
        }),
        tx.wishlistItem.findMany({
          where: { requested_by: user.id },
          select: { id: true },
        }),
        tx.transaction.findMany({
          where: { user_id: user.id },
          select: { id: true },
        }),
      ]);
      const removedTargetIds = [
        ...assignmentIds,
        ...habitLogIds,
        ...badgeIds,
        ...redemptionIds,
        ...wishlistIds,
        ...transactionIds,
      ].map((record) => record.id);
      if (removedTargetIds.length > 0) {
        await tx.importedRecord.deleteMany({
          where: { family_id: familyId, target_id: { in: removedTargetIds } },
        });
      }

      await Promise.all([
        tx.chore.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.chore.updateMany({
          where: { assigned_to: user.id },
          data: { assigned_to: successorId },
        }),
        tx.event.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.list.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.listItem.updateMany({
          where: { added_by: user.id },
          data: { added_by: successorId },
        }),
        tx.listItem.updateMany({
          where: { checked_by: user.id },
          data: { checked_by: null },
        }),
        tx.reward.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.reward.updateMany({
          where: { claimed_by: user.id },
          data: { claimed_by: null },
        }),
        tx.reward.updateMany({
          where: { approved_by: user.id },
          data: { approved_by: null },
        }),
        tx.budgetCategory.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.project.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.projectTask.updateMany({
          where: { assigned_to: user.id },
          data: { assigned_to: null },
        }),
        tx.familyMeal.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.familyMeal.updateMany({
          where: { cook_id: user.id },
          data: { cook_id: null },
        }),
        tx.pinnedNote.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.anniversary.updateMany({
          where: { person_id: user.id },
          data: { person_id: null },
        }),
        tx.emergencyContact.updateMany({
          where: { person_id: user.id },
          data: { person_id: null },
        }),
        tx.pickup.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.pickup.updateMany({
          where: { assigned_to: user.id },
          data: { assigned_to: null },
        }),
        tx.handoff.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.wishlistItem.updateMany({
          where: { status_changed_by: user.id },
          data: { status_changed_by: null },
        }),
        tx.sickDay.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.medication.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.choreAssignment.updateMany({
          where: { completed_by: user.id },
          data: { completed_by: null },
        }),
        tx.choreAssignment.updateMany({
          where: { approved_by: user.id },
          data: { approved_by: null },
        }),
        tx.importJob.updateMany({
          where: { started_by: user.id },
          data: { started_by: successorId },
        }),
        tx.habit.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.rewardRedemption.updateMany({
          where: { approved_by: user.id },
          data: { approved_by: null },
        }),
        tx.familyGoal.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.recipe.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.mealPlan.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
        tx.shoppingList.updateMany({
          where: { created_by: user.id },
          data: { created_by: successorId },
        }),
      ]);

      await tx.$executeRaw`
        UPDATE "Message"
        SET "read_by" = array_remove("read_by", ${user.id})
        WHERE "family_id" = ${familyId} AND ${user.id} = ANY("read_by")
      `;

      await Promise.all([
        tx.message.deleteMany({ where: { sender_id: user.id } }),
        tx.transaction.deleteMany({ where: { user_id: user.id } }),
      ]);
      await tx.user.delete({ where: { id: user.id } });
      return { deleted: true, mode: "account" as const };
    },
    { timeout: 60_000 },
  );
}
