import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireFamilyMatch } from "@/lib/api-auth";
import { notificationServiceServer } from "@/lib/notifications-server";
import { completeChoreSchema } from "@/lib/validations";
import { measureCoreMutation } from "@/lib/beta-metrics";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    const body = await request.json();
    const parsed = completeChoreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { choreId, photoUrl } = parsed.data;

    // Get the chore and verify family ownership
    const chore = await prisma!.chore.findUnique({
      where: { id: choreId },
      include: {
        assignee: {
          select: { id: true, name: true, avatar_url: true, role: true },
        },
        creator: {
          select: { id: true, name: true, avatar_url: true, role: true },
        },
      },
    });

    if (!chore) {
      return NextResponse.json({ error: "Chore not found" }, { status: 404 });
    }

    const familyError = requireFamilyMatch(
      chore.family_id,
      auth.user.family_id,
    );
    if (familyError) return familyError;

    // Complete the full logical mutation atomically. The metric is recorded only
    // after the status update, activity and recurring occurrence all succeed.
    const completion = await measureCoreMutation(
      {
        familyId: auth.user.family_id,
        actorRole: auth.user.role,
        eventName: "chore.complete",
      },
      () =>
        prisma!.$transaction(async (tx) => {
          const updateResult = await tx.chore.updateMany({
            where: { id: choreId, status: { not: "completed" } },
            data: {
              status: "completed",
              completed_at: new Date(),
              ...(photoUrl
                ? { photo_url: photoUrl, photo_verified: false }
                : {}),
            },
          });

          if (updateResult.count === 0) {
            return { alreadyCompleted: true as const };
          }

          await tx.activity.create({
            data: {
              family_id: auth.user.family_id,
              user_id: auth.user.id,
              type: "chore_completed",
              title: `${auth.user.name} completed "${chore.title}"`,
            },
          });

          if (chore.frequency && chore.frequency !== "once") {
            const dueDate = new Date(chore.due_date);
            let nextDueDate: Date;

            switch (chore.frequency) {
              case "daily":
                nextDueDate = new Date(dueDate);
                nextDueDate.setDate(nextDueDate.getDate() + 1);
                break;
              case "weekly":
                nextDueDate = new Date(dueDate);
                nextDueDate.setDate(nextDueDate.getDate() + 7);
                break;
              case "monthly":
                nextDueDate = new Date(dueDate);
                nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                break;
              default:
                return { alreadyCompleted: false as const };
            }

            await tx.chore.create({
              data: {
                family_id: chore.family_id,
                title: chore.title,
                description: chore.description,
                points: chore.points,
                assigned_to: chore.assigned_to,
                due_date: nextDueDate,
                status: "pending",
                frequency: chore.frequency,
                difficulty: chore.difficulty,
                created_by: chore.created_by,
              },
            });
          }

          return { alreadyCompleted: false as const };
        }),
      (result) => !result.alreadyCompleted,
    );

    if (completion.alreadyCompleted) {
      return NextResponse.json({ success: true, alreadyCompleted: true });
    }

    return NextResponse.json({
      success: true,
      choreId,
    });
  } catch (error) {
    console.error("Error completing chore:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
