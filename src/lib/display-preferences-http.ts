import { storageBackend } from "@/lib/storage-backend";
import {
  readD1DisplayPreferences,
  updateD1DisplayPreferences,
  updateD1DisplayDefaults,
} from "@/lib/cloudflare/display-preferences";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithUser } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { prisma } from "@/lib/prisma";
import { apiError, logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  displayPatchSchema,
  defaultsPatchSchema,
} from "@/lib/display-preferences-schema";
import {
  DisplayPreferencesError,
  readDisplayPreferences,
  updateDisplayPreferences,
  updateDisplayDefaults,
} from "@/lib/display-preferences-server";
const headers = { "Cache-Control": "private, no-store" };
/** Explicit-state, revision-guarded writes are safe to reconcile after a lost response. */
export async function displayPreferencesRequest(
  request: NextRequest,
  scope: "person" | "household",
  write: boolean,
) {
  const requestId = getRequestId(request);
  const fail = (status: number, code: string, message: string) =>
    apiError(status, code, message, { shape: "nested", requestId, headers });
  try {
    const refusal = await refusePairedDevice(request);
    if (refusal) return refusal;
    const [auth, error] = await authenticateWithUser(request);
    if (error) return error;
    if (
      scope === "household" &&
      (auth.user.role !== "parent" || !auth.user.family_id)
    )
      return fail(403, "FORBIDDEN", "A parent in a household is required.");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    if (!write)
      return NextResponse.json(
        storageBackend() === "d1"
          ? await readD1DisplayPreferences(actor)
          : await readDisplayPreferences(prisma!, actor),
        {
          headers,
        },
      );
    const raw = await request.text();
    if (raw.length > 12_000)
      return fail(413, "BODY_TOO_LARGE", "Preference update is too large.");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return fail(400, "INVALID_JSON", "Invalid JSON.");
    }
    if (scope === "person") {
      const parsed = displayPatchSchema.safeParse(body);
      if (!parsed.success)
        return fail(400, "VALIDATION_ERROR", "Invalid display preferences.");
      return NextResponse.json(
        storageBackend() === "d1"
          ? await updateD1DisplayPreferences(actor, parsed.data)
          : await updateDisplayPreferences(prisma!, actor, parsed.data),
        { headers },
      );
    }
    const parsed = defaultsPatchSchema.safeParse(body);
    if (!parsed.success)
      return fail(400, "VALIDATION_ERROR", "Invalid household defaults.");
    return NextResponse.json(
      storageBackend() === "d1"
        ? await updateD1DisplayDefaults(
            actor,
            parsed.data.expectedRevision,
            parsed.data.today,
          )
        : await updateDisplayDefaults(
            prisma!,
            actor,
            parsed.data.expectedRevision,
            parsed.data.today,
          ),
      { headers },
    );
  } catch (error) {
    if (error instanceof DisplayPreferencesError) {
      if (error.code === "UNAUTHORIZED")
        return fail(401, error.code, "Sign in again.");
      if (error.code === "FORBIDDEN")
        return fail(403, error.code, "Access changed. Refresh to continue.");
      if (error.code === "CONFLICT")
        return fail(
          409,
          error.code,
          "Preferences changed on another device. Refresh before saving again.",
        );
      return fail(
        409,
        "DISPLAY_PREFERENCES_UNSUPPORTED",
        "This preference version is not supported.",
      );
    }
    logRouteError(`${request.method} display-preferences`, error, requestId);
    return fail(
      500,
      "INTERNAL_ERROR",
      "Preferences could not be loaded or saved.",
    );
  }
}
