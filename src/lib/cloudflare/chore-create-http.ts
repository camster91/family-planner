import type { NextRequest } from "next/server";
import type { TokenPayload } from "@/lib/auth";
import type { AssistantSourceGuard } from "@/lib/assistant-source-proof";
import { AssistantSourceRefused } from "@/lib/assistant-source-proof";
import { ASSISTANT_PROFILE_REVISION_HEADER } from "@/lib/assistant-reference-contract";
import { createChoreSchema } from "@/lib/validations";
import { profileChoreCreateSchema } from "@/lib/profile-chore-create-contract";
import {
  isProfileChoreEnabled,
  isProfileChoreRecurrenceSupported,
  profileChoreProtocolRefusal,
} from "@/lib/chore-profile";
import { guardReviewDocumentSubmission } from "@/lib/review-document-submit-server";
import { REVIEW_SUBMIT_HEADERS } from "@/lib/review-document-submit-contract";
import { readIdempotencyKey, idempotencyError } from "@/lib/idempotency";
import { readChoreCreateReceiptIdentity } from "@/lib/chore-create-receipt-identity";
import { choreJson } from "@/lib/chore-json";
import { recordChoreAssigned } from "@/lib/beta-metrics";
import { notificationServiceServer } from "@/lib/notifications-server";
import { prisma } from "@/lib/prisma";
import {
  createD1Chore,
  readD1CreatedChore,
  renewD1ChoreCreateActor,
  type ChoreCreateCommand,
} from "./chore-create";
type Auth = {
  payload: TokenPayload;
  user: { id: string; family_id: string; role: string };
};
const unavailable = () =>
  choreJson(
    { error: "MEMBER_PROTOCOL_UNAVAILABLE", ...profileChoreProtocolRefusal() },
    { status: 409 },
  );
export async function handleD1ChoreCreation(
  request: NextRequest,
  auth: Auth,
  body: unknown,
  sourceGuard?: AssistantSourceGuard,
) {
  const actor = {
    userId: auth.user.id,
    familyId: auth.user.family_id,
    generation: auth.payload.tv ?? 0,
  };
  const profile =
    !!body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    ("protocol" in body || "selection" in body);
  let command: ChoreCreateCommand,
    compact = request.headers.has(REVIEW_SUBMIT_HEADERS.contract);
  if (profile) {
    const revisionHeader = request.headers.get(
      ASSISTANT_PROFILE_REVISION_HEADER,
    );
    if (
      revisionHeader !== null &&
      (!/^(0|[1-9][0-9]{0,9})$/.test(revisionHeader) ||
        Number(revisionHeader) > 2147483647)
    )
      throw new AssistantSourceRefused();
    const expectedRevision =
      revisionHeader === null ? undefined : Number(revisionHeader);
    if (sourceGuard && expectedRevision === undefined)
      throw new AssistantSourceRefused();
    const refused = guardReviewDocumentSubmission(
      request,
      auth,
      "chore.profile.create",
    );
    if (refused) return refused;
    if (!isProfileChoreEnabled()) return unavailable();
    const parsed = profileChoreCreateSchema.safeParse(body);
    if (!parsed.success)
      return choreJson(
        { error: "The profile chore request is not valid." },
        { status: 400 },
      );
    if (
      parsed.data.frequency !== "once" &&
      !isProfileChoreRecurrenceSupported()
    )
      return unavailable();
    command = { kind: "profile", input: parsed.data, expectedRevision };
    compact = compact || expectedRevision !== undefined;
  } else {
    const refused = guardReviewDocumentSubmission(
      request,
      auth,
      "chore.create",
    );
    if (refused) return refused;
    const parsed = createChoreSchema.safeParse(body);
    if (!parsed.success)
      return choreJson(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    command = { kind: "account", input: parsed.data };
  }
  const { key, error } = readIdempotencyKey(request);
  if (error) return error;
  if (profile && !key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
  const result = await createD1Chore(actor, command, key, {
    sourceGuard,
    compact,
  });
  const headers = result.replayed
    ? { "Idempotency-Replayed": "true" }
    : undefined;
  if (result.status < 200 || result.status >= 300)
    return choreJson(result.body, { status: result.status, headers });
  if (result.created) {
    await recordChoreAssigned(prisma!, actor.familyId, result.created, {
      now: result.created.created_at,
    });
    if (!result.created.notifiedInTx && result.created.assignee)
      await notificationServiceServer.notifyChoreAssignment(
        { ...result.created, family_id: actor.familyId },
        result.created.assignee,
        result.created.creator,
      );
  }
  if (
    profile &&
    (!isProfileChoreEnabled() ||
      (command.input.frequency !== "once" &&
        !isProfileChoreRecurrenceSupported()))
  )
    return unavailable();
  const identity = readChoreCreateReceiptIdentity(result.body);
  if (!identity) return choreJson({ error: "Chore confirmation unavailable" }, { status: 409, headers });
  if (compact) {
    const denied = await renewD1ChoreCreateActor(actor);
    // A legacy profile receipt may contain an old DTO. Bound submissions get
    // only its admitted insertion pointer, never that cached private snapshot.
    return denied ? choreJson(denied.body, { status: denied.status, headers }) : choreJson(identity, { status: result.status, headers });
  }
  const projection = await readD1CreatedChore(
    actor,
    identity,
    command.kind === "profile" ? command.input.selection.memberId : undefined,
  );
  if (projection.status !== 200)
    return choreJson(
      profile
        ? { error: "Profile chore confirmation unavailable" }
        : projection.body,
      { status: projection.status, headers },
    );
  const denied = await renewD1ChoreCreateActor(actor);
  if (denied) return choreJson(denied.body, { status: denied.status, headers });
  if (
    profile &&
    (!isProfileChoreEnabled() ||
      (command.input.frequency !== "once" &&
        !isProfileChoreRecurrenceSupported()))
  )
    return unavailable();
  return choreJson(
    profile ? { ...(projection.body as object), ...identity } : projection.body,
    { headers },
  );
}
