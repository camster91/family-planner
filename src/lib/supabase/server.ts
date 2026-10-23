import { cookies } from "next/headers";
import { verifySessionToken } from "@/lib/session";
import { hasLivePairedDevice } from "@/lib/device-refusal";

// Returns the authenticated user from the session cookie. Used by server
// components and route handlers. `role` and `family_id` are the member's
// CURRENT values from the database (D6, #102): `verifySessionToken` resolves
// them in the same query as the session-generation check, so a role or
// household change takes effect on the next request instead of when the
// cookie expires. The JWT's own role/family_id claims are never trusted.
//
// This is the server-component counterpart to `authenticateRequest`, and it
// goes through the SAME `verifySessionToken` check. Using bare `verifyToken`
// here meant a revoked cookie (password reset/change bumps `token_version`)
// still authenticated every page and route that reads the session this way.
type ServerUser = {
  id: string;
  email: string;
  role?: string;
  family_id?: string | null;
};

/** Internal read authority. Carry the verified cookie's generation into later
 * queries; reading a newer database generation must never renew an old cookie.
 * Do not serialize this internal projection into client-facing user DTOs.
 */
export async function getServerActor(): Promise<
  (ServerUser & { tokenVersion: number }) | null
> {
  const cookieStore = await cookies();
  // Server components cannot return an API response, so they treat a live
  // paired tablet as anonymous. API route handlers that need the stable 403
  // contract call refusePairedDevice(request) before this helper.
  if (await hasLivePairedDevice({ cookies: cookieStore })) return null;

  const token = cookieStore.get("session_token")?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload || !payload.userId) return null;
  const tokenVersion = payload.tv ?? 0;
  if (!Number.isSafeInteger(tokenVersion) || tokenVersion < 0) return null;

  return {
    id: payload.userId,
    email: payload.email as string,
    role: payload.role,
    family_id: payload.family_id ?? null,
    tokenVersion,
  };
}

/** Preserve the established four-field server-user projection for callers that
 * do not need to carry authority across another asynchronous read boundary.
 */
export async function getServerUser(): Promise<ServerUser | null> {
  const actor = await getServerActor();
  if (!actor) return null;
  return {
    id: actor.id,
    email: actor.email,
    role: actor.role,
    family_id: actor.family_id,
  };
}

// Legacy export kept so existing imports don't break during migration.
// Callers should migrate to getServerUser() + prisma directly.
export async function createClient() {
  throw new Error(
    "Supabase has been removed. Use getServerUser() + prisma instead.",
  );
}
