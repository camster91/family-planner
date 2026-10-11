import { NextRequest } from "next/server";
import {
  authenticateProfileParent,
  readJson,
  readRequiredIdempotencyKey,
  routeBodyError,
  runProfileCommand,
} from "@/lib/household-profile-http";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [auth, error] = await authenticateProfileParent(request);
  if (error) return error;
  const key = await readRequiredIdempotencyKey(request);
  if (typeof key !== "string") return key;
  const { id } = await params;
  const parsedBody = await readJson(request);
  if (parsedBody.response) return parsedBody.response;
  const parsed = routeBodyError(request, parsedBody.body, "edit", id);
  if (parsed.response) return parsed.response;
  return runProfileCommand(request, auth, key, parsed.input);
}
