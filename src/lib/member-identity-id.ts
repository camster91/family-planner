/**
 * Zod-free stable identifier check for browser startup surfaces. The Zod
 * `memberIdentityIdSchema` (member-identity-schema.ts) is built from this same
 * pattern and remains the server/composition contract.
 */
export const MEMBER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function isMemberIdentityId(value: unknown): value is string {
  return typeof value === "string" && MEMBER_ID_PATTERN.test(value);
}
