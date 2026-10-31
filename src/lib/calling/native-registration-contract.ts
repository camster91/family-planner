import { z } from "zod";

export const NATIVE_CALL_REGISTRATION_PROTOCOL = "herewoven.native-calls.v1";
export const NATIVE_INSTALLATION_LIMIT = 8;
export const NATIVE_INSTALLATION_TTL_MS = 30 * 24 * 60 * 60_000;
export const NATIVE_REGISTRATION_WINDOW_MS = 5 * 60_000;
export const NATIVE_REVOCATION_HOLD_MS = 6 * 60_000;
const owner = z
  .object({
    userId: z.string().min(1).max(200),
    familyId: z.string().min(1).max(200),
    generation: z.number().int().nonnegative(),
  })
  .strict();
export type NativeCallOwner = z.infer<typeof owner>;
const expected = z
  .object({ epoch: z.string().uuid(), revision: z.number().int().positive() })
  .strict();
const common = {
  protocol: z.literal(NATIVE_CALL_REGISTRATION_PROTOCOL),
  commandId: z.string().uuid(),
  issuedAt: z.number().int().nonnegative(),
  installationId: z.string().uuid(),
  owner,
  expected: expected.nullable(),
  label: z.string().trim().min(1).max(40),
};
export const nativeRegistrationSchema = z.discriminatedUnion("platform", [
  z
    .object({
      ...common,
      platform: z.literal("ios"),
      provider: z.literal("apns-voip"),
      token: z
        .string()
        .regex(/^[a-fA-F0-9]{32,512}$/)
        .transform((s) => s.toLowerCase()),
    })
    .strict(),
  z
    .object({
      ...common,
      platform: z.literal("android"),
      provider: z.literal("fcm"),
      token: z
        .string()
        .min(16)
        .max(4096)
        .regex(/^[\x21-\x7e]+$/),
    })
    .strict(),
]);
export type NativeRegistration = z.infer<typeof nativeRegistrationSchema>;
export const nativeUnregisterSchema = z
  .object({
    protocol: z.literal(NATIVE_CALL_REGISTRATION_PROTOCOL),
    issuedAt: z.number().int().nonnegative(),
    installationId: z.string().uuid(),
    owner,
    expected,
  })
  .strict();

export function sameNativeOwner(a: NativeCallOwner, b: NativeCallOwner) {
  return (
    a.userId === b.userId &&
    a.familyId === b.familyId &&
    a.generation === b.generation
  );
}
