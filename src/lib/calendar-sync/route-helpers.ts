// Shared route plumbing for /api/calendar/connections/** and
// /api/calendar/sync-connections/** (#264).

import { NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { isCalendarSyncEnabled } from "./config";

export const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export const notFound = () => json({ error: "Not found" }, 404);

type Auth = {
  user: { id: string; family_id: string; role: string; name: string };
};

/**
 * Kill switch first (404 while no provider is configured, whoever calls),
 * then person-session auth (a device cookie is not a session: 401), then
 * parent-only (teens and children: 403).
 */
export async function authParentForSync(
  request: any,
): Promise<[Auth, null] | [null, NextResponse]> {
  if (!isCalendarSyncEnabled()) return [null, notFound()];
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return [null, error];
  if (auth.user.role !== "parent") {
    return [
      null,
      json(
        {
          error: "Only parents can manage connected calendars",
          code: "PARENT_REQUIRED",
        },
        403,
      ),
    ];
  }
  return [auth, null];
}
