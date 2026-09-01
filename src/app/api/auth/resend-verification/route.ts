import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { createVerificationToken } from "@/lib/tokens";
import {
  sendTransactionalEmail,
  verificationEmail,
} from "@/lib/transactional-email";

const responseMessage =
  "If an unverified account exists with that email, a verification link has been sent.";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const body = await request.json().catch(() => null);
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255) {
    return NextResponse.json(
      { error: "A valid email is required" },
      { status: 400 },
    );
  }

  const emailKey = crypto.createHash("sha256").update(email).digest("hex");
  const [ipLimit, emailLimit] = await Promise.all([
    checkRateLimit(`verify-resend-ip:${ip}`, 10, 60 * 60 * 1000),
    checkRateLimit(`verify-resend-email:${emailKey}`, 3, 60 * 60 * 1000),
  ]);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  const user = await prisma!.user.findUnique({ where: { email } });
  if (!user || user.email_verified)
    return NextResponse.json({ message: responseMessage });

  try {
    const token = await createVerificationToken(user.id);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://family.ashbi.ca";
    const verifyUrl = `${appUrl}/api/auth/verify-email?token=${token}`;
    await sendTransactionalEmail({
      to: user.email,
      ...verificationEmail(user.name, verifyUrl),
    });
  } catch (deliveryError) {
    await prisma!.user.update({
      where: { id: user.id },
      data: { verify_token: null, verify_token_expires: null },
    });
    console.error("Verification resend delivery failed:", deliveryError);
  }

  return NextResponse.json({ message: responseMessage });
}
