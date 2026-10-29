import { storageBackend } from "@/lib/storage-backend";
import { manageD1HouseholdProfile, listD1HouseholdProfiles } from "@/lib/cloudflare/household-profiles";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-route";
import { apiError, logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { idempotencyError, readIdempotencyKey } from "@/lib/idempotency";
import {
  HouseholdProfileError,
  householdProfileCommand,
  manageHouseholdProfile,
  type PublicHouseholdProfile,
} from "@/lib/household-profile-management";
import {
  isProfileAgeAllowed,
  profileRoleSchema,
} from "@/lib/member-subject-contract";
import { prisma } from "@/lib/prisma";
import { isProfileAccountLinkEnabled } from "@/lib/profile-account-link-gate";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
} from "@/lib/chore-profile";

export const NO_STORE = { "Cache-Control": "private, no-store" };
export const PROFILE_SETUP_ENABLE_ENV = "HOUSEHOLD_PROFILE_SETUP_ENABLED";
export const PROFILE_SETUP_UNSUPPORTED_CODE = "PROFILE_SETUP_UNSUPPORTED";
const PROFILE_SETUP_UNSUPPORTED_MESSAGE =
  "Household profile setup is not enabled for this server configuration. Use a compatible app or server.";

const CREATE_KEYS = new Set(["name", "role", "age"]);
const EDIT_KEYS = new Set(["name", "role", "age", "revision"]);
const ARCHIVE_KEYS = new Set(["revision"]);
const profileId = z.string().min(1).max(128);
const publicProfileRole = profileRoleSchema;
const publicProfileDto = z
  .object({
    id: z.string(),
    family_id: z.string(),
    name: z.string(),
    role: publicProfileRole,
    age: z.number().int().nullable(),
    archived_at: z.string().nullable(),
    revision: z.number().int(),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (!isProfileAgeAllowed(profile.role, profile.age)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["age"],
        message: "Profile age is not valid for this presentation role.",
      });
    }
  });

export type ProfileAuth = {
  payload: { userId: string; tv?: number };
  user: { id: string; family_id: string; role: string };
};

export function withNoStore(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(NO_STORE))
    response.headers.set(name, value);
  return response;
}

/**
 * Profile routes stay source-dormant until the member-domain compatibility
 * gates are accepted. This is deliberately a server opt-in rather than a
 * client-visible capability: auth and paired-device policy must still run
 * before the unsupported response is returned.
 */
export function requireProfileSetupEnabled(
  request: NextRequest,
): NextResponse | null {
  if (process.env[PROFILE_SETUP_ENABLE_ENV] === "1") return null;
  return apiError(
    409,
    PROFILE_SETUP_UNSUPPORTED_CODE,
    PROFILE_SETUP_UNSUPPORTED_MESSAGE,
    {
      requestId: getRequestId(request),
      shape: "nested",
      retryable: false,
      headers: NO_STORE,
    },
  );
}

/**
 * Profile setup is a person-session operation. Keep this refusal before auth,
 * even though authenticateWithFamily repeats the shared boundary internally,
 * so a paired tablet never gets a chance to use a lingering person cookie.
 */
export async function authenticateProfileParent(
  request: NextRequest,
): Promise<[ProfileAuth, null] | [null, NextResponse]> {
  const deviceRefusal = await refusePairedDevice(request);
  if (deviceRefusal) return [null, withNoStore(deviceRefusal)];

  const [auth, error] = await authenticateWithFamily(request);
  if (error) return [null, withNoStore(error)];
  const parentError = requireParent(auth.user.role);
  if (parentError) return [null, withNoStore(parentError)];
  const setupError = requireProfileSetupEnabled(request);
  if (setupError) return [null, setupError];
  return [
    {
      payload: auth.payload,
      user: {
        id: auth.user.id,
        family_id: auth.user.family_id,
        role: auth.user.role,
      },
    },
    null,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidBody(
  request: NextRequest,
  message = "The profile request is not valid.",
) {
  return apiError(400, "PROFILE_INVALID", message, {
    requestId: getRequestId(request),
    shape: "nested",
    headers: NO_STORE,
  });
}

export async function readJson(
  request: NextRequest,
): Promise<
  { body: unknown; response: null } | { body: null; response: NextResponse }
> {
  try {
    return { body: await request.json(), response: null };
  } catch {
    return {
      body: null,
      response: apiError(
        400,
        "INVALID_JSON",
        "Send a valid JSON profile request.",
        {
          requestId: getRequestId(request),
          shape: "nested",
          headers: NO_STORE,
        },
      ),
    };
  }
}

function parseBody(
  request: NextRequest,
  body: unknown,
  action: "create" | "edit" | "archive",
  id?: string,
):
  { input: unknown; response: null } | { input: null; response: NextResponse } {
  if (!isRecord(body)) return { input: null, response: invalidBody(request) };
  const keys =
    action === "create"
      ? CREATE_KEYS
      : action === "edit"
        ? EDIT_KEYS
        : ARCHIVE_KEYS;
  if (Object.keys(body).some((key) => !keys.has(key))) {
    return {
      input: null,
      response: invalidBody(
        request,
        "Only the documented profile fields are accepted.",
      ),
    };
  }
  if (action !== "create") {
    const parsedId = profileId.safeParse(id);
    if (!parsedId.success) {
      return {
        input: null,
        response: invalidBody(request, "The profile id is not valid."),
      };
    }
  }
  const input =
    action === "create" ? { ...body, action } : { ...body, action, id };
  const parsed = householdProfileCommand.safeParse(input);
  if (!parsed.success) return { input: null, response: invalidBody(request) };
  return { input: parsed.data, response: null };
}

export async function readRequiredIdempotencyKey(
  request: NextRequest,
): Promise<string | NextResponse> {
  const { key, error } = readIdempotencyKey(request);
  if (error) return withNoStore(error);
  if (!key) return withNoStore(idempotencyError("IDEMPOTENCY_KEY_REQUIRED"));
  return key;
}

function commandError(
  request: NextRequest,
  error: HouseholdProfileError,
): NextResponse {
  if (error.code === "KEY_REUSED")
    return withNoStore(idempotencyError("IDEMPOTENCY_KEY_REUSED"));
  const mapped = {
    INVALID: [400, "PROFILE_INVALID", "The profile request is not valid."],
    UNAUTHORIZED: [
      401,
      "PROFILE_UNAUTHORIZED",
      "Your session is no longer valid.",
    ],
    FORBIDDEN: [
      403,
      "PROFILE_FORBIDDEN",
      "You cannot manage this household profile.",
    ],
    NOT_FOUND: [
      404,
      "PROFILE_NOT_FOUND",
      "That profile is not in your household.",
    ],
    CONFLICT: [
      409,
      "PROFILE_CONFLICT",
      "The profile changed. Refresh and try again.",
    ],
  } as const;
  const [status, code, message] = mapped[error.code];
  return apiError(status, code, message, {
    requestId: getRequestId(request),
    shape: "nested",
    headers: NO_STORE,
  });
}

export async function runProfileCommand(
  request: NextRequest,
  auth: ProfileAuth,
  key: string,
  input: unknown,
): Promise<NextResponse> {
  try {
    // The command owns the transaction and replay record. Do not wrap this in
    // withIdempotency: nesting would create a second lock and split the effect.
    const actor = { userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0 };
    const result = storageBackend() === "d1"
      ? await manageD1HouseholdProfile(actor, key, input)
      : await manageHouseholdProfile(prisma!, actor, key, input);
    const headers: Record<string, string> = { ...NO_STORE };
    if (result.replayed) headers["Idempotency-Replayed"] = "true";
    const status = isRecord(input) && input.action === "create" ? 201 : 200;
    const dto = toProfileDto(result.profile);
    if (!dto) {
      return apiError(
        500,
        "PROFILE_STORAGE_INVALID",
        "Household profiles are temporarily unavailable.",
        {
          requestId: getRequestId(request),
          shape: "nested",
          headers: NO_STORE,
        },
      );
    }
    return NextResponse.json(
      { profile: dto },
      { status: result.replayed ? 200 : status, headers },
    );
  } catch (error) {
    if (error instanceof HouseholdProfileError)
      return commandError(request, error);
    logRouteError("profile command", error, getRequestId(request));
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Could not save this profile. Try again.",
      {
        requestId: getRequestId(request),
        shape: "nested",
        headers: NO_STORE,
      },
    );
  }
}

export function toProfileDto(
  profile: PublicHouseholdProfile | Record<string, unknown>,
): PublicHouseholdProfile | null {
  const archivedAt = profile.archived_at;
  const parsed = publicProfileDto.safeParse({
    id: profile.id,
    family_id: profile.family_id,
    name: profile.name,
    role: profile.role,
    age: profile.age,
    archived_at:
      archivedAt instanceof Date ? archivedAt.toISOString() : archivedAt,
    revision: profile.revision,
  });
  return parsed.success ? parsed.data : null;
}

export async function listProfiles(
  request: NextRequest,
  auth: ProfileAuth,
): Promise<NextResponse> {
  try {
    const profiles = storageBackend() === "d1"
      ? await listD1HouseholdProfiles({ userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0 })
      : await prisma!.householdMember.findMany({
      where: {
        family_id: auth.user.family_id,
        legacy_mapping: { is: null },
        account_link: { is: null },
        erasure_user_id: null,
      },
      select: {
        id: true,
        family_id: true,
        name: true,
        role: true,
        age: true,
        archived_at: true,
        revision: true,
      },
      orderBy: [
        { archived_at: { sort: "asc", nulls: "first" } },
        { name: "asc" },
        { id: "asc" },
      ],
    });
    const dtos = profiles.map(toProfileDto);
    if (dtos.some((profile): profile is null => profile === null)) {
      return apiError(
        500,
        "PROFILE_STORAGE_INVALID",
        "Household profiles are temporarily unavailable.",
        {
          requestId: getRequestId(request),
          shape: "nested",
          headers: NO_STORE,
        },
      );
    }
    const profileChoreSupported = isProfileChoreEnabled();
    return NextResponse.json(
      {
        profiles: dtos,
        profileChoreSupported,
        ...(isProfileAccountLinkEnabled() ? { profileAccountLinkSupported: true } : {}),
        ...(isProfileChoreRecurrenceSupported()
          ? { profileChoreRecurrenceSupported: true }
          : {}),
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    if (error instanceof HouseholdProfileError) return commandError(request, error);
    logRouteError("GET /api/family/profiles", error, getRequestId(request));
    return apiError(
      500,
      "INTERNAL_ERROR",
      "Could not load household profiles.",
      {
        requestId: getRequestId(request),
        shape: "nested",
        headers: NO_STORE,
      },
    );
  }
}

export function routeBodyError(
  request: NextRequest,
  body: unknown,
  action: "create" | "edit" | "archive",
  id?: string,
) {
  return parseBody(request, body, action, id);
}
