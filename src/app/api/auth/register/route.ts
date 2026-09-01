import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { registerSchema } from "@/lib/validations";
import { createVerificationToken } from "@/lib/tokens";
import {
  sendTransactionalEmail,
  verificationEmail,
} from "@/lib/transactional-email";

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  // Rate limit BEFORE any DB lookup — prevents email enumeration attacks
  const rateCheck = await checkRateLimit(`register:${ip}`, 20, 60 * 60 * 1000);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(rateCheck.retryAfterMs / 1000)),
        },
      },
    );
  }

  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { email, password, name, role } = parsed.data;

    const existing = await prisma!.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json(
        { error: "Email already registered" },
        { status: 409 },
      );
    }

    const hashed = await hashPassword(password);

    // Build user.create data — include email_verified defensively.
    // If the column doesn't exist in the live DB (older deploy before
    // migration), retry without it. This makes the route forward-compatible
    // across rolling deploys.
    const createData: Record<string, unknown> = {
      email,
      password: hashed,
      name,
      role,
    };
    let user;
    try {
      createData.email_verified = false;
      user = await prisma!.user.create({ data: createData as any });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("email_verified") || msg.includes("does not exist")) {
        // Old deployment without the column — retry without it
        delete createData.email_verified;
        user = await prisma!.user.create({ data: createData as any });
      } else {
        throw e;
      }
    }

    let verificationEmailSent = false;
    try {
      const verifyToken = await createVerificationToken(user.id);
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://family.ashbi.ca";
      const verifyUrl = appUrl + "/api/auth/verify-email?token=" + verifyToken;
      await sendTransactionalEmail({
        to: email,
        ...verificationEmail(name, verifyUrl),
      });
      verificationEmailSent = true;
    } catch (deliveryError) {
      console.error("Verification email delivery failed:", deliveryError);
    }

    // NOTE: We deliberately do NOT issue a session token here. The user must
    // verify their email first, then log in. See /api/auth/login for the
    // verification gate.

    const { password: _, ...userWithoutPassword } = user;
    const response = NextResponse.json({
      user: userWithoutPassword,
      requiresVerification: true,
      verificationEmailSent,
    });
    return response;
  } catch (error) {
    console.error("Register error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
