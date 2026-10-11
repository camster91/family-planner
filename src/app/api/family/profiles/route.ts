import { NextRequest } from "next/server";
import {
  authenticateProfileParent,
  listProfiles,
  readJson,
  readRequiredIdempotencyKey,
  routeBodyError,
  runProfileCommand,
} from "@/lib/household-profile-http";

export const dynamic = "force-dynamic";

/**
 * Dormant parent profile surface for the name-only household roster. It is
 * intentionally additive: account-backed /api/family/members is unchanged,
 * and no client or capability advertises this route yet.
 */
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateProfileParent(request);
  if (error) return error;
  return listProfiles(request, auth);
}

export async function POST(request: NextRequest) {
  const [auth, error] = await authenticateProfileParent(request);
  if (error) return error;
  const key = await readRequiredIdempotencyKey(request);
  if (typeof key !== "string") return key;
  const parsedBody = await readJson(request);
  if (parsedBody.response) return parsedBody.response;
  const parsed = routeBodyError(request, parsedBody.body, "create");
  if (parsed.response) return parsed.response;
  return runProfileCommand(request, auth, key, parsed.input);
}
