import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const base = {
  familyId: z.string().min(1).max(128),
  label: z.string().min(1).max(60),
  endpointId: z.string().uuid(),
  origin: z.string().url().max(256),
  cookieHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuedAt: z.number().int(),
  expiresAt: z.number().int(),
  purpose: z.literal("family-call-v1"),
};
export const grantSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...base,
      kind: z.literal("person"),
      userId: z.string().min(1).max(128),
      generation: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("device"),
      deviceId: z.string().min(1).max(128),
      sessionId: z.string().min(1).max(128),
    })
    .strict(),
]);
export type CallGrant = z.infer<typeof grantSchema>;
export const callCookieHash = (cookie: string) =>
  createHash("sha256")
    .update("family-call-cookie-v1\0" + cookie)
    .digest("hex");
const signature = (body: string, secret: string) =>
  createHmac("sha256", secret)
    .update("family-call-grant-v1\0" + body)
    .digest();
export function signCallGrant(grant: CallGrant, secret: string) {
  if (secret.length < 32) throw Error("Calling unavailable");
  const body = Buffer.from(JSON.stringify(grantSchema.parse(grant))).toString(
    "base64url",
  );
  return body + "." + signature(body, secret).toString("base64url");
}
export function verifyCallGrant(
  token: string,
  secret: string,
  origin: string,
  cookie: string,
  now = Date.now(),
): CallGrant | null {
  try {
    if (!cookie || secret.length < 32 || token.length > 4096) return null;
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra) return null;
    const expected = signature(body, secret),
      received = Buffer.from(mac, "base64url");
    if (
      received.length !== expected.length ||
      !timingSafeEqual(expected, received)
    )
      return null;
    const grant = grantSchema.parse(
      JSON.parse(Buffer.from(body, "base64url").toString("utf8")),
    );
    if (
      grant.origin !== origin ||
      grant.cookieHash !== callCookieHash(cookie) ||
      grant.issuedAt > now ||
      grant.expiresAt <= now ||
      grant.expiresAt - grant.issuedAt !== 60_000
    )
      return null;
    return grant;
  } catch {
    return null;
  }
}
