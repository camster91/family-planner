import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { apiError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { QUEUE_OWNER_CONTRACT } from "@/lib/queue-owner-contract";
import {
  isQueueOwnerRecoveryEnabled,
  personQueueOwner,
} from "@/lib/queue-owner-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
export async function GET(request: NextRequest) {
  // Includes paired-device refusal before reading a lingering person cookie.
  const [auth, error] = await authenticateWithFamily(request);
  if (error) {
    error.headers.set("Cache-Control", headers["Cache-Control"]);
    return error;
  }
  if (!isQueueOwnerRecoveryEnabled())
    return NextResponse.json(
      { contract: QUEUE_OWNER_CONTRACT, enabled: false },
      { headers },
    );
  const owner = personQueueOwner(request, auth.payload);
  if (!owner)
    return apiError(
      409,
      "QUEUE_SESSION_REQUIRED",
      "Sign in again before recovering saved changes.",
      { requestId: getRequestId(request), shape: "nested", headers },
    );
  return NextResponse.json(
    { contract: QUEUE_OWNER_CONTRACT, enabled: true, owner },
    { headers },
  );
}
