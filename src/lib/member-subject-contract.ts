import { z } from "zod";
import { MEMBER_ID_PATTERN } from "@/lib/member-identity-schema";

/**
 * Legacy subject schemas remain classic-Zod contracts. Browser-safe eager
 * leaves import the equivalent Mini schema directly from member-identity-
 * schema.ts so this compatibility surface does not pull classic Zod into
 * those bundles.
 */
export const memberIdentityIdSchema = z.string().regex(MEMBER_ID_PATTERN);

/**
 * Stable identifiers are opaque to the member contract. They are validated
 * for transport safety only; no name, email or display value is identity
 * evidence.
 */
export const memberDisplayNameSchema = z.string().trim().min(1).max(100);

export const profileRoleSchema = z.enum(["child", "teen", "parent"]);
export type ProfileRole = z.infer<typeof profileRoleSchema>;

export const memberProtocolSchema = z.union([z.literal(1), z.literal(2)]);
export type MemberProtocol = z.infer<typeof memberProtocolSchema>;

export const profileAgeSchema = z.number().int().min(0).max(120).nullable();

const PROFILE_AGE_BOUNDS: Record<ProfileRole, { min: number; max: number }> = {
  child: { min: 0, max: 17 },
  teen: { min: 13, max: 17 },
  parent: { min: 18, max: 120 },
};

export function isProfileAgeAllowed(
  role: ProfileRole,
  age: number | null | undefined,
): boolean {
  if (age === null || age === undefined) return true;
  const bounds = PROFILE_AGE_BOUNDS[role];
  return age >= bounds.min && age <= bounds.max;
}

/** A presentation role is never an authenticated account role or permission. */
export const profileSubjectSchema = z
  .object({
    kind: z.literal("profile"),
    memberId: memberIdentityIdSchema,
    familyId: memberIdentityIdSchema,
    name: memberDisplayNameSchema,
    role: profileRoleSchema,
    age: profileAgeSchema,
  })
  .strict()
  .superRefine((subject, ctx) => {
    if (!isProfileAgeAllowed(subject.role, subject.age)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["age"],
        message: "Profile age is not valid for this presentation role.",
      });
    }
  });

/** A User is an account-backed subject; its ID must never be reused for a profile. */
export const accountSubjectSchema = z
  .object({
    kind: z.literal("account"),
    accountId: memberIdentityIdSchema,
    familyId: memberIdentityIdSchema,
    name: memberDisplayNameSchema,
  })
  .strict();

// `profileSubjectSchema` is refined for role/age compatibility, which makes
// it a ZodEffects schema. A plain union keeps that validation while remaining
// compatible with Zod 3's discriminated-union requirement for raw objects.
export const memberSubjectSchema = z.union([
  accountSubjectSchema,
  profileSubjectSchema,
]);
export type MemberSubject = z.infer<typeof memberSubjectSchema>;

/**
 * The credential-bearing actor is separate from the person being represented
 * by an action. A device has no User identity, and a profile has no authority.
 */
export const authenticatedActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("person"),
      userId: memberIdentityIdSchema,
      familyId: memberIdentityIdSchema,
      role: profileRoleSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("device"),
      deviceId: memberIdentityIdSchema,
      familyId: memberIdentityIdSchema,
    })
    .strict(),
]);
export type AuthenticatedMemberActor = z.infer<typeof authenticatedActorSchema>;

export type MemberProtocolDecision =
  | { supported: true }
  | {
      supported: false;
      code: "MEMBER_PROTOCOL_UNAVAILABLE";
      recovery: "refresh-and-retain-pending";
    };

/** Protocol 1 accepts account subjects only; protocol 2 adds explicit profiles. */
export function checkMemberSubjectProtocol(
  protocol: MemberProtocol,
  subject: MemberSubject,
): MemberProtocolDecision {
  if (protocol === 1 && subject.kind === "profile") {
    return {
      supported: false,
      code: "MEMBER_PROTOCOL_UNAVAILABLE",
      recovery: "refresh-and-retain-pending",
    };
  }
  return { supported: true };
}

/**
 * Shared-device/person selection input. Keep the legacy field exact for
 * protocol 1; the server must resolve `actingMemberId` to an account subject
 * before constructing a MemberActionContext. A profile ID is never inferred
 * from that legacy field.
 */
export const legacyAccountSelectionSchema = z
  .object({ actingMemberId: memberIdentityIdSchema })
  .strict();

export const profileSelectionSchema = z
  .object({ memberId: memberIdentityIdSchema })
  .strict();

export const memberSelectionSchema = z.union([
  legacyAccountSelectionSchema,
  profileSelectionSchema,
]);
export type MemberSelection = z.infer<typeof memberSelectionSchema>;

export type MemberActionContext = {
  actor: AuthenticatedMemberActor;
  subject: MemberSubject;
  protocol: MemberProtocol;
};

/** Runtime boundary for code that is about to attribute an allowed action. */
export const memberActionContextSchema = z
  .object({
    actor: authenticatedActorSchema,
    subject: memberSubjectSchema,
    protocol: memberProtocolSchema,
  })
  .strict()
  .superRefine((context, ctx) => {
    const decision = checkMemberSubjectProtocol(
      context.protocol,
      context.subject,
    );
    if (!decision.supported) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["protocol"],
        message: decision.code,
      });
    }
    // The actor role is intentionally not compared with the profile role:
    // presentation metadata must never grant or remove account authority.
    if (context.actor.familyId !== context.subject.familyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["subject", "familyId"],
        message: "Subject is outside the actor household.",
      });
    }
  });
