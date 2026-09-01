import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { clearResetToken, createResetToken } from "@/lib/tokens";
import {
  passwordResetEmail,
  sendTransactionalEmail,
} from "@/lib/transactional-email";

export async function POST(request: NextRequest) {
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const rateCheck = await checkRateLimit(`forgot:${ip}`, 5, 60 * 60 * 1000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 },
      );
    }

    const { email } = await request.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    const user = await prisma!.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always return success to prevent email enumeration
    if (!user) {
      return NextResponse.json({
        message:
          "If an account exists with that email, a reset link has been sent.",
      });
    }

    const token = await createResetToken(user.id);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://family.ashbi.ca";
    const resetUrl = appUrl + "/reset-password?token=" + token;

    try {
      await sendTransactionalEmail({
        to: user.email,
        ...passwordResetEmail(user.name, resetUrl),
      });
    } catch (deliveryError) {
      await clearResetToken(user.id);
      console.error("Password reset delivery failed:", deliveryError);
    }

    return NextResponse.json({
      message:
        "If an account exists with that email, a reset link has been sent.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
