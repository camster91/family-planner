import { NextRequest, NextResponse } from "next/server";
import { apiError, logRouteError } from "@/lib/api-error";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { idempotencyError, readIdempotencyKey } from "@/lib/idempotency";
import { parseDateOnly } from "@/lib/dates";
import { getRequestId } from "@/lib/request-id";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { requestedMemberProtocol } from "@/lib/chore-profile";
import { prisma } from "@/lib/prisma";
import {
  readParentRoutineStack,
  type RoutineStackReadDb,
  saveParentRoutineStack,
  type RoutineStackWriteDb,
} from "@/lib/routine-stack-api";
import {
  RoutineStackMutationError,
  RoutineStackValidationError,
} from "@/lib/routine-stack-mutation";

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

function validOccurrenceDate(value: string | null): value is string {
  return value !== null && parseDateOnly(value) !== null;
}

function routineStackActor(
  request: NextRequest,
  user: { family_id: string; id: string; role: string },
) {
  const memberProtocol = requestedMemberProtocol(request);
  return {
    familyId: user.family_id,
    userId: user.id,
    role: user.role,
    ...(memberProtocol === 2 ? { memberProtocol } : {}),
  };
}

/** GET /api/chores/stacks?stack_id=<id>&occurrence_date=YYYY-MM-DD. */
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
    const stackId = params.get("stack_id");
    const occurrenceDate = params.get("occurrence_date");
    if (
      !stackId ||
      stackId.length > 128 ||
      !validOccurrenceDate(occurrenceDate)
    ) {
      return error(
        400,
        "INVALID_QUERY",
        "Choose a routine and a valid occurrence date.",
        requestId,
      );
    }

    const result = await readParentRoutineStack(
      prisma! as unknown as RoutineStackReadDb,
      routineStackActor(request, auth.user),
      stackId,
      occurrenceDate,
    );
    if (!result) {
      return error(
        404,
        "ROUTINE_STACK_NOT_FOUND",
        "That routine is not available.",
        requestId,
      );
    }
    if (
      "body" in result &&
      result.body.code === "MEMBER_PROTOCOL_UNAVAILABLE"
    ) {
      return NextResponse.json(result.body, {
        status: result.status,
        headers: NO_STORE,
      });
    }
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (caught) {
    logRouteError("GET /api/chores/stacks", caught, requestId);
    return error(
      500,
      "INTERNAL_ERROR",
      "Could not load this routine.",
      requestId,
      true,
    );
  }
}

/**
 * POST /api/chores/stacks — save one current occurrence. The idempotency key
 * is mandatory because one request can create several chore rows and reorder
 * existing rows atomically.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  try {
    const [auth, authError] = await authenticateWithFamily(request);
    if (authError) return authError;
    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;
    const gate = await featureGate(auth.user.family_id, "chores");
    if (gate) return gate;

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error(400, "INVALID_JSON", "Invalid JSON.", requestId);
    }

    const result = await saveParentRoutineStack(
      prisma! as unknown as RoutineStackWriteDb,
      body,
      routineStackActor(request, auth.user),
      key,
    );
    const response = NextResponse.json(result.body, { status: result.status });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (caught) {
    if (caught instanceof RoutineStackValidationError) {
      return error(400, caught.code, caught.message, requestId);
    }
    if (caught instanceof RoutineStackMutationError) {
      return error(
        caught.status,
        caught.code,
        caught.message,
        requestId,
        caught.status >= 500,
      );
    }
    if (caught instanceof HouseholdMemberIdentityConflict) {
      return error(
        409,
        "IDENTITY_CONFLICT",
        "A household member identity needs review before this change.",
        requestId,
      );
    }
    logRouteError("POST /api/chores/stacks", caught, requestId);
    return error(
      500,
      "INTERNAL_ERROR",
      "Could not save this routine. Please retry.",
      requestId,
      true,
    );
  }
}
