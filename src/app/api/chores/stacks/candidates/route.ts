import { NextRequest, NextResponse } from "next/server";
import { apiError, logRouteError } from "@/lib/api-error";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { CHORE_PAGE_MAX, decodeChoreCursor } from "@/lib/chore-paging";
import { parseDateOnly } from "@/lib/dates";
import { getRequestId } from "@/lib/request-id";
import { prisma } from "@/lib/prisma";
import { requestedMemberProtocol } from "@/lib/chore-profile";
import { storageBackend } from "@/lib/storage-backend";
import {
  readParentRoutineStackCandidates,
  type RoutineStackCandidateDb,
} from "@/lib/routine-stack-api";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function error(
  status: number,
  code: string,
  message: string,
  requestId: string,
  retryable = false,
) {
  return apiError(status, code, message, {
    requestId,
    shape: "nested",
    retryable,
    headers: NO_STORE,
  });
}

function parseLimit(raw: string | null): number | null {
  if (raw === null) return CHORE_PAGE_MAX;
  if (!/^\d{1,3}$/.test(raw)) return null;
  const limit = Number(raw);
  return limit >= 1 && limit <= CHORE_PAGE_MAX ? limit : null;
}

function routineStackActor(
  request: NextRequest,
  user: { family_id: string; id: string; role: string },
  tokenVersion?: number,
) {
  const memberProtocol = requestedMemberProtocol(request);
  return {
    familyId: user.family_id,
    userId: user.id,
    role: user.role,
    ...(tokenVersion === undefined ? {} : { tokenVersion }),
    ...(memberProtocol === 2 ? { memberProtocol } : {}),
  };
}

/**
 * GET /api/chores/stacks/candidates?occurrence_date=YYYY-MM-DD.
 *
 * This is a parent-only, read-only catalog for starting a stack or adding an
 * unstacked current occurrence. It deliberately does not return templates,
 * private chore history, profile/account mappings, or any future-series rows.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const [auth, authError] = await authenticateWithFamily(request);
    if (authError) return authError;
    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;
    const gate = await featureGate(auth.user.family_id, "chores");
    if (gate) return gate;

    const params = new URL(request.url).searchParams;
    const occurrenceDate = params.get("occurrence_date");
    if (!occurrenceDate || !parseDateOnly(occurrenceDate)) {
      return error(
        400,
        "INVALID_QUERY",
        "Choose a valid occurrence date.",
        requestId,
      );
    }
    const limit = parseLimit(params.get("limit"));
    if (limit === null) {
      return error(
        400,
        "INVALID_QUERY",
        `limit must be a whole number from 1 to ${CHORE_PAGE_MAX}.`,
        requestId,
      );
    }
    const rawCursor = params.get("cursor");
    const cursor = rawCursor === null ? null : decodeChoreCursor(rawCursor);
    if (rawCursor !== null && !cursor) {
      return error(400, "INVALID_QUERY", "Invalid cursor.", requestId);
    }

    if (storageBackend() === "d1") {
      const result = await (await import("@/lib/cloudflare/routine-stack")).readD1RoutineStackCandidates(routineStackActor(request, auth.user, auth.payload.tv ?? 0), occurrenceDate, { limit, cursor });
      if (!result) return error(404, "ROUTINE_CANDIDATES_NOT_FOUND", "Those routine candidates are not available.", requestId);
      return NextResponse.json(result, { headers: NO_STORE });
    }
    const result = await readParentRoutineStackCandidates(
      prisma! as unknown as RoutineStackCandidateDb,
      routineStackActor(request, auth.user),
      occurrenceDate,
      { limit, cursor },
    );
    if (!result) {
      return error(
        404,
        "ROUTINE_CANDIDATES_NOT_FOUND",
        "Those routine candidates are not available.",
        requestId,
      );
    }
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (caught) {
    logRouteError("GET /api/chores/stacks/candidates", caught, requestId);
    return error(
      500,
      "INTERNAL_ERROR",
      "Could not load routine candidates.",
      requestId,
      true,
    );
  }
}
