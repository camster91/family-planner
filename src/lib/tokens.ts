import crypto from "crypto";
import { prisma } from "./prisma";

// Generate a secure random token
export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Store password-reset token (1 hour expiry, separate from verify token)
export async function createResetToken(userId: string): Promise<string> {
  const token = generateToken();
  const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await prisma!.user.update({
    where: { id: userId },
    data: {
      reset_token: hashToken(token),
      reset_token_expires: expires,
    },
  });

  return token;
}

// Verify and consume password-reset token
export async function verifyResetToken(token: string): Promise<string | null> {
  const user = await prisma!.user.findFirst({
    where: {
      reset_token: hashToken(token),
      reset_token_expires: { gt: new Date() },
    },
  });

  if (!user) return null;
  return user.id;
}

// Clear password-reset token after use
export async function clearResetToken(userId: string): Promise<void> {
  await prisma!.user.update({
    where: { id: userId },
    data: {
      reset_token: null,
      reset_token_expires: null,
    },
  });
}

export async function consumeResetToken(
  token: string,
  password: string,
): Promise<boolean> {
  if (!prisma) throw new Error("Database is not configured");
  const tokenHash = hashToken(token);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: {
        reset_token: tokenHash,
        reset_token_expires: { gt: new Date() },
      },
      select: { id: true, family_id: true },
    });
    if (!user) return false;

    const consumed = await tx.user.updateMany({
      where: { id: user.id, reset_token: tokenHash },
      data: {
        password,
        reset_token: null,
        reset_token_expires: null,
      },
    });
    if (consumed.count === 1 && user.family_id) {
      await tx.auditLog.create({
        data: {
          family_id: user.family_id,
          actor_id: user.id,
          action: "account.password_reset",
          resource_type: "User",
          resource_id: user.id,
        },
      });
    }
    return consumed.count === 1;
  });
}

// Create email verification token (24 hour expiry, separate from reset token)
// Stored in its own columns so a user can request both simultaneously without
// one overwriting the other.
export async function createVerificationToken(userId: string): Promise<string> {
  const token = generateToken();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await prisma!.user.update({
    where: { id: userId },
    data: {
      verify_token: hashToken(token),
      verify_token_expires: expires,
    },
  });

  return token;
}

// Verify email token (does NOT consume — that's done by markEmailVerified)
export async function verifyEmailToken(token: string): Promise<string | null> {
  const user = await prisma!.user.findFirst({
    where: {
      verify_token: hashToken(token),
      verify_token_expires: { gt: new Date() },
    },
  });

  if (!user) return null;
  return user.id;
}

// Mark email as verified and clear the verify token
export async function markEmailVerified(userId: string): Promise<void> {
  await prisma!.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        email_verified: true,
        verify_token: null,
        verify_token_expires: null,
      },
      select: { family_id: true },
    });
    if (user.family_id) {
      await tx.auditLog.create({
        data: {
          family_id: user.family_id,
          actor_id: userId,
          action: "account.email_verified",
          resource_type: "User",
          resource_id: userId,
        },
      });
    }
  });
}
