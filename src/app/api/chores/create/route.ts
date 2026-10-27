import { readCreatedProfileChore } from "@/lib/chore-profile";
import { readChoreCreateReceiptIdentity } from "@/lib/chore-create-receipt-identity";
import { ASSISTANT_PROFILE_REVISION_HEADER } from "@/lib/assistant-reference-contract";
import {
  assistantSourceGuard,
  authorizeAssistantSourceReplay,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import { REVIEW_SUBMIT_HEADERS } from "@/lib/review-document-submit-contract";
import {
  ACCOUNT_CHORE_CREATE_ACTION,
  createPersonChore,
  authorizePersonChoreCreation,
  readCreatedPersonChore,
} from "@/lib/person-chore-create";
import { choreJson } from "@/lib/chore-json";
import { nextSelectedWeekday } from "@/lib/chore-weekdays";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { createChoreSchema } from "@/lib/validations";
import { rotationMembersInHousehold } from "@/lib/chore-rotation";
import { normalizeDateOnlyInput } from "@/lib/dates";
import { resolveChorePhotoForWrite } from "@/lib/chore-photos";
import {
  isGamificationOn,
  omitChorePoints,
} from "@/lib/gamification-visibility";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { lockHousehold, lockUser } from "@/lib/household-lock";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import {
  createProfileOnlyChoreEffect,
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  profileChoreCreateSchema,
  profileChoreProtocolRefusal,
  ProfileChoreError,
  PROFILE_CHORE_UNSUPPORTED_CODE,
} from "@/lib/chore-profile";
import {
  idempotencyError,
  readIdempotencyKey,
  withIdempotency,
} from "@/lib/idempotency";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const sourceGuard = assistantSourceGuard(
      request,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        role: auth.user.role,
        generation: auth.payload?.tv ?? 0,
      },
      "chore_create",
    );

    // Only parents can create chores (mirrors the PATCH gate — kids shouldn't
    // be able to assign work or set their own point values)
    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return choreJson({ error: "Invalid JSON" }, { status: 400 });
    }
    // Profile assignment is an explicit, gated protocol-2 branch. Do not pass
    // it through the legacy schema: that would either reject a valid profile
    // target or, worse, infer an account from a member id.
    if (
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      (body.protocol !== undefined || body.selection !== undefined)
    ) {
      const revisionHeader = request.headers.get(
        ASSISTANT_PROFILE_REVISION_HEADER,
      );
      if (
        revisionHeader !== null &&
        (!/^(0|[1-9][0-9]{0,9})$/.test(revisionHeader) ||
          Number(revisionHeader) > 2147483647)
      )
        throw new AssistantSourceRefused();
      const expectedProfileRevision =
        revisionHeader === null ? undefined : Number(revisionHeader);
      // The versioned assistant path must supply the reviewed profile revision;
      // older canonical clients keep their existing explicit protocol-2 branch.
      if (sourceGuard && expectedProfileRevision === undefined)
        throw new AssistantSourceRefused();
      const reviewRefusal = guardReviewDocumentSubmission(
        request,
        auth,
        "chore.profile.create",
      );
      if (reviewRefusal) return reviewRefusal;
      if (!isProfileChoreEnabled()) {
        return choreJson(
          {
            error: PROFILE_CHORE_UNSUPPORTED_CODE,
            ...profileChoreProtocolRefusal(),
          },
          { status: 409, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const profile = profileChoreCreateSchema.safeParse(body);
      if (!profile.success) {
        return choreJson(
          { error: "The profile chore request is not valid." },
          { status: 400 },
        );
      }
      // Keep recurring profile writes behind their own private rollout gate.
      // This check intentionally precedes idempotency-key lookup so a cached
      // response cannot replay after the recurrence capability is withdrawn.
      if (
        profile.data.frequency !== "once" &&
        !isProfileChoreRecurrenceSupported()
      ) {
        return choreJson(
          {
            error: PROFILE_CHORE_UNSUPPORTED_CODE,
            ...profileChoreProtocolRefusal(),
          },
          { status: 409, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const { key, error: keyError } = readIdempotencyKey(request);
      if (keyError) return keyError;
      if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
      const startDate = normalizeDateOnlyInput(profile.data.due_date);
      const dueDate =
        startDate && profile.data.frequency === "weekly"
          ? nextSelectedWeekday(startDate, profile.data.weekly_days, true)
          : startDate;
      if (!dueDate)
        return choreJson({ error: "Invalid date" }, { status: 400 });
      const photo = await resolveChorePhotoForWrite(
        auth.user.family_id,
        profile.data.photo_url,
      );
      if (!photo.ok) return choreJson({ error: photo.error }, { status: 400 });
      const response = await withIdempotency(
        prisma!,
        key,
        {
          scope: `user:${auth.user.id}`,
          familyId: auth.user.family_id,
          userId: auth.user.id,
          action: "chore.profile.create",
        },
        expectedProfileRevision === undefined
          ? profile.data
          : {
              ...profile.data,
              assistant_profile_revision: expectedProfileRevision,
            },
        ({ recordId }) =>
          createProfileOnlyChoreEffect(
            prisma!,
            {
              id: auth.user.id,
              familyId: auth.user.family_id,
              tokenVersion: auth.payload.tv ?? 0,
            },
            profile.data,
            dueDate,
            photo.value ?? null,
            recordId,
            new Date(),
            {
              compactReceipt:
                expectedProfileRevision !== undefined ||
                request.headers.has(REVIEW_SUBMIT_HEADERS.contract),
              sourceGuard,
              expectedProfileRevision,
            },
          ),
        {
          // A completed receipt contains private household data. Re-check the
          // live actor under the same membership locks before replaying it.
          beforeReplay: () =>
            prisma!.$transaction(async (tx) => {
              await lockUser(tx, auth.user.id);
              await lockHousehold(tx, auth.user.family_id);
              const currentActor = await tx.user.findUnique({
                where: { id: auth.user.id },
                select: { family_id: true, role: true, token_version: true },
              });
              if (
                !currentActor ||
                currentActor.family_id !== auth.user.family_id ||
                currentActor.role !== "parent" ||
                currentActor.token_version !== (auth.payload.tv ?? 0)
              ) {
                return {
                  status: 404,
                  body: { error: "PROFILE_TARGET_UNAVAILABLE" },
                };
              }
              return null;
            }),
        },
      );
      response.headers.set("Cache-Control", "private, no-store");
      if (!response.ok) return response;
      if (!isProfileChoreEnabled() || (profile.data.frequency !== "once" && !isProfileChoreRecurrenceSupported()))
        return choreJson({ error: PROFILE_CHORE_UNSUPPORTED_CODE, ...profileChoreProtocolRefusal() }, { status: 409 });
      const compact = expectedProfileRevision !== undefined || request.headers.has(REVIEW_SUBMIT_HEADERS.contract);
      if (compact) {
        const denied = await authorizePersonChoreCreation(prisma!, {
          userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0,
        });
        if (denied) return choreJson(denied.body, { status: denied.status, headers: response.headers });
        if (!isProfileChoreEnabled() || (profile.data.frequency !== "once" && !isProfileChoreRecurrenceSupported()))
          return choreJson({ error: PROFILE_CHORE_UNSUPPORTED_CODE, ...profileChoreProtocolRefusal() }, { status: 409 });
        return response;
      }
      const identity = readChoreCreateReceiptIdentity(await response.json());
      if (!identity) return choreJson({ error: "Chore confirmation unavailable" }, { status: 409 });
      const projection = await readCreatedProfileChore(prisma!, {
        id: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0,
      }, identity, profile.data.selection.memberId);
      if (!projection.ok) return choreJson({ error: "Profile chore confirmation unavailable" }, { status: projection.status });
      const denied = await authorizePersonChoreCreation(prisma!, {
        userId: auth.user.id, familyId: auth.user.family_id, tokenVersion: auth.payload.tv ?? 0,
      });
      if (denied) return choreJson(denied.body, { status: denied.status, headers: response.headers });
      if (!isProfileChoreEnabled() || (profile.data.frequency !== "once" && !isProfileChoreRecurrenceSupported()))
        return choreJson({ error: PROFILE_CHORE_UNSUPPORTED_CODE, ...profileChoreProtocolRefusal() }, { status: 409 });
      return choreJson({ chore: projection.chore, ...identity }, { status: response.status, headers: response.headers });
    }

    const reviewRefusal = guardReviewDocumentSubmission(
      request,
      auth,
      "chore.create",
    );
    if (reviewRefusal) return reviewRefusal;
    const parsed = createChoreSchema.safeParse(body);
    if (!parsed.success) {
      return choreJson(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const { due_date, frequency, photo_url } = parsed.data;
    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    // Take turns (O-39): the first person in the order takes the first one,
    // whatever `assigned_to` says.
    const rotation = parsed.data.rotation ?? null;
    const assigned_to = rotation ? rotation[0] : parsed.data.assigned_to!;

    // due_date is a date-only value: store the UTC calendar day at midnight.
    const startDate = normalizeDateOnlyInput(due_date);
    const dueDate =
      startDate && frequency === "weekly" && parsed.data.weekly_days
        ? nextSelectedWeekday(startDate, parsed.data.weekly_days, true)
        : startDate;
    if (!dueDate) {
      return choreJson({ error: "Invalid date" }, { status: 400 });
    }

    // Verify the assigned user belongs to the same family
    const assignee = await prisma!.user.findUnique({
      where: { id: assigned_to },
      select: { id: true, family_id: true, name: true },
    });

    if (!assignee || assignee.family_id !== auth.user.family_id) {
      return choreJson(
        { error: "Assigned user must be in your family" },
        { status: 400 },
      );
    }

    // Everyone taking turns must be in the caller's household (another
    // household's member reads the same as a missing one).
    if (
      rotation &&
      !(await rotationMembersInHousehold(
        prisma!,
        auth.user.family_id,
        rotation,
      ))
    ) {
      return choreJson(
        { error: "Everyone taking turns must be in your family" },
        { status: 400 },
      );
    }

    // D3 (#102): a photo must be an upload owned by the caller's family.
    const photo = await resolveChorePhotoForWrite(
      auth.user.family_id,
      photo_url,
    );
    if (!photo.ok) {
      return choreJson({ error: photo.error }, { status: 400 });
    }

    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        familyId: actor.familyId,
        userId: actor.userId,
        action: ACCOUNT_CHORE_CREATE_ACTION,
      },
      parsed.data,
      ({ recordId }) =>
        createPersonChore(
          prisma!,
          actor,
          parsed.data,
          dueDate,
          photo.value ?? null,
          recordId,
          getRequestId(request),
          sourceGuard,
        ),
      {
        beforeReplay: async () => {
          const denied = await authorizePersonChoreCreation(prisma!, actor);
          if (denied) return denied;
          return authorizeAssistantSourceReplay(prisma!, sourceGuard);
        },
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    if (!response.ok || request.headers.has(REVIEW_SUBMIT_HEADERS.contract))
      return response;
    const result = readChoreCreateReceiptIdentity(await response.json());
    if (!result)
      return choreJson(
        { error: "Chore confirmation unavailable" },
        { status: 409 },
      );
    const projection = await readCreatedPersonChore(
      prisma!,
      actor,
      result.choreId,
      result.choreGeneration,
    );
    if (!projection.ok)
      return choreJson(projection.result.body, {
        status: projection.result.status,
        headers: response.headers,
      });
    const chore = (await isGamificationOn(auth.user.family_id))
      ? projection.chore
      : omitChorePoints(projection.chore);
    const disclosureDenied = await authorizePersonChoreCreation(prisma!, actor);
    if (disclosureDenied) return choreJson(disclosureDenied.body, { status: disclosureDenied.status, headers: response.headers });
    return choreJson({ chore }, { headers: response.headers });
  } catch (error) {
    if (error instanceof AssistantSourceRefused) return error.response();
    if (error instanceof ProfileChoreError) {
      const status =
        error.code === "PROFILE_TARGET_CONFLICT"
          ? 409
          : error.code === "PROFILE_TARGET_UNAVAILABLE"
            ? 404
            : 400;
      return choreJson({ error: error.code }, { status });
    }
    if (error instanceof HouseholdMemberIdentityConflict)
      return choreJson(
        { error: error.message, code: "IDENTITY_CONFLICT" },
        { status: 409 },
      );
    logRouteError("POST /api/chores/create", error, getRequestId(request));
    return choreJson({ error: "Internal server error" }, { status: 500 });
  }
}
