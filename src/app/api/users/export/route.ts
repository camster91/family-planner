import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

// GET - Export all data for the current user (GDPR Article 20 — data portability)
// Returns a JSON document containing:
// - User profile (no password)
// - Family info
// - All chores they created or are assigned to
// - All lists they created
// - All messages they sent
// - All events they created
// - All rewards they created or claimed
// - All notifications addressed to them
// - All activities they performed
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request);
    if (error) return error;

    const userId = payload.userId;

    // Fetch all data in parallel
    const [
      user,
      family,
      chores,
      lists,
      messages,
      events,
      rewards,
      notifications,
      activities,
      transactions,
      projects,
      recipes,
      mealPlans,
      shoppingLists,
      habits,
      habitLogs,
      earnedBadges,
      rewardRedemptions,
      familyGoals,
      importJobs,
      financeArchive,
      familyMeals,
      pinnedNotes,
      anniversaries,
      locations,
      emergencyContacts,
      pickups,
      allowances,
      wishlistItems,
      handoffs,
      sickDays,
      medications,
      assignedProjectTasks,
    ] = await Promise.all([
      prisma!.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          age: true,
          xp: true,
          level: true,
          streak: true,
          best_streak: true,
          avatar_url: true,
          last_chore_date: true,
          created_at: true,
          email_verified: true,
          // Explicitly EXCLUDE password
        },
      }),
      prisma!.user
        .findUnique({ where: { id: userId }, select: { family_id: true } })
        .then((u) =>
          u?.family_id
            ? prisma!.family.findUnique({ where: { id: u.family_id } })
            : null,
        ),
      prisma!.chore.findMany({
        where: {
          OR: [
            { created_by: userId },
            { assigned_to: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
        include: {
          assignee: { select: { id: true, name: true } },
          creator: { select: { id: true, name: true } },
        },
      }),
      prisma!.list.findMany({
        where: {
          OR: [
            { created_by: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
        include: { items: true },
      }),
      prisma!.message.findMany({
        where: { sender_id: userId },
      }),
      prisma!.event.findMany({
        where: { created_by: userId },
      }),
      prisma!.reward.findMany({
        where: {
          OR: [
            { created_by: userId },
            { claimed_by: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
      }),
      prisma!.notification.findMany({
        where: { user_id: userId },
      }),
      prisma!.activity.findMany({
        where: { user_id: userId },
      }),
      prisma!.transaction.findMany({
        where: { user_id: userId },
      }),
      prisma!.project.findMany({
        where: {
          OR: [
            { created_by: userId },
            { family: { members: { some: { id: userId } } } },
          ],
        },
        include: { tasks: true },
      }),
      prisma!.recipe.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { ingredients: { include: { ingredient: true } } },
      }),
      prisma!.mealPlan.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { entries: true },
      }),
      prisma!.shoppingList.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { items: true },
      }),
      prisma!.habit.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.habitLog.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.earnedBadge.findMany({
        where: { family: { members: { some: { id: userId } } } },
        include: { badge: true },
      }),
      prisma!.rewardRedemption.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.familyGoal.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.importJob.findMany({
        where: {
          family: { members: { some: { id: userId, role: "parent" } } },
        },
        select: {
          id: true,
          source_app: true,
          source_version: true,
          status: true,
          dry_run: true,
          started_at: true,
          completed_at: true,
          summary: true,
          error: true,
        },
      }),
      prisma!.financialArchiveRecord.findMany({
        where: {
          family: { members: { some: { id: userId, role: "parent" } } },
        },
      }),
      prisma!.familyMeal.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.pinnedNote.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.anniversary.findMany({
        where: {
          OR: [
            { person_id: userId },
            { family: { members: { some: { id: userId, role: "parent" } } } },
          ],
        },
      }),
      prisma!.familyLocation.findMany({ where: { user_id: userId } }),
      prisma!.emergencyContact.findMany({
        where: {
          OR: [
            { person_id: userId },
            { family: { members: { some: { id: userId, role: "parent" } } } },
          ],
        },
      }),
      prisma!.pickup.findMany({
        where: {
          OR: [
            { assigned_to: userId },
            { created_by: userId },
            { family: { members: { some: { id: userId, role: "parent" } } } },
          ],
        },
      }),
      prisma!.allowance.findMany({
        where: {
          OR: [
            { from_user_id: userId },
            { to_user_id: userId },
            { family: { members: { some: { id: userId, role: "parent" } } } },
          ],
        },
      }),
      prisma!.wishlistItem.findMany({
        where: { family: { members: { some: { id: userId } } } },
      }),
      prisma!.handoff.findMany({ where: { created_by: userId } }),
      prisma!.sickDay.findMany({
        where: {
          OR: [
            { person_id: userId },
            { created_by: userId },
            { family: { members: { some: { id: userId, role: "parent" } } } },
          ],
        },
      }),
      prisma!.medication.findMany({
        where: {
          OR: [
            { person_id: userId },
            { created_by: userId },
            { family: { members: { some: { id: userId, role: "parent" } } } },
          ],
        },
      }),
      prisma!.projectTask.findMany({ where: { assigned_to: userId } }),
    ]);

    const exportData = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      user,
      family,
      chores,
      lists,
      messages,
      events,
      rewards,
      notifications,
      activities,
      transactions,
      projects,
      recipes,
      mealPlans,
      shoppingLists,
      habits,
      habitLogs,
      earnedBadges,
      rewardRedemptions,
      familyGoals,
      importJobs,
      financeArchive,
      familyMeals,
      pinnedNotes,
      anniversaries,
      locations,
      emergencyContacts,
      pickups,
      allowances,
      wishlistItems,
      handoffs,
      sickDays,
      medications,
      assignedProjectTasks,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="family-planner-export-${Date.now()}.json"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Error exporting user data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
