import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateRequest } from "@/lib/api-auth";
import { updateUserSchema } from "@/lib/validations";
import { safeVerifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { deleteAccountData, LastParentError } from "@/lib/account-deletion";

export const dynamic = "force-dynamic";

// GET - Get current user's full profile
export async function GET(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request);
    if (error) return error;

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        age: true,
        family_id: true,
        avatar_url: true,
        last_chore_date: true,
        xp: true,
        level: true,
        streak: true,
        best_streak: true,
        email_verified: true,
        created_at: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Error fetching user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH - Update user profile (no family_id changes allowed)
export async function PATCH(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request);
    if (error) return error;

    const body = await request.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.age !== undefined) {
      updateData.age = parsed.data.age
        ? parseInt(String(parsed.data.age))
        : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 },
      );
    }

    const user = await prisma!.user.update({
      where: { id: payload.userId },
      data: updateData,
    });

    if (user.family_id) {
      await prisma!.auditLog.create({
        data: {
          family_id: user.family_id,
          actor_id: user.id,
          action: "account.profile_updated",
          resource_type: "User",
          resource_id: user.id,
          metadata: { fields: Object.keys(updateData) },
        },
      });
    }

    const { password: _, ...userWithoutPassword } = user;

    return NextResponse.json({ user: userWithoutPassword });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Delete the current user's account (GDPR Article 17 — right to erasure)
// Parents cannot delete their account if they are the last parent in the family —
// the family must have at least one parent at all times. Children can always
// delete themselves.
export async function DELETE(request: NextRequest) {
  try {
    const [payload, error] = await authenticateRequest(request);
    if (error) return error;

    const body = await request.json().catch(() => null);
    const password = typeof body?.password === "string" ? body.password : "";
    const deleteFamily = body?.deleteFamily === true;
    const expectedConfirmation = deleteFamily ? "DELETE FAMILY" : "DELETE";
    if (body?.confirmation !== expectedConfirmation || !password) {
      return NextResponse.json(
        {
          error: `Enter your password and type ${expectedConfirmation} to confirm.`,
        },
        { status: 400 },
      );
    }

    const rateLimit = await checkRateLimit(
      `delete-account:${payload.userId}`,
      5,
      60 * 60 * 1000,
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Too many deletion attempts. Try again later." },
        { status: 429 },
      );
    }

    const user = await prisma!.user.findUnique({
      where: { id: payload.userId },
    });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (!(await safeVerifyPassword(password, user.password))) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 403 },
      );
    }

    try {
      await deleteAccountData(user.id, deleteFamily);
    } catch (deleteError) {
      if (deleteError instanceof LastParentError) {
        return NextResponse.json(
          {
            error:
              "You are the final parent. Choose whole-family deletion and type DELETE FAMILY to continue.",
            code: "LAST_PARENT",
          },
          { status: 409 },
        );
      }
      throw deleteError;
    }

    // Clear session cookie
    const response = NextResponse.json({ success: true });
    response.cookies.set("session_token", "", {
      path: "/",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
