import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { responsibilityStorageAvailable } from "@/lib/responsibility-storage";
import {
  authorizeResponsibilityReceipt,
  responsibilityFailure,
} from "@/lib/responsibility-server";
import {
  responsibilityOwner,
  responsibilityWritingEnabled,
} from "@/lib/responsibility-owner";
import { ResponsibilityError } from "@/lib/responsibility";
import {
  RESPONSIBILITY_RECOVERY,
  RESPONSIBILITY_OWNER_HEADER,
  responsibilityRecoveryInput,
} from "@/lib/responsibility-recovery";
import { reviewResponsibilityRequest } from "@/lib/responsibility-recovery-server";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: NextRequest, review: boolean) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!prisma) throw new ResponsibilityError("UNAVAILABLE");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      tokenVersion: auth.payload.tv ?? 0,
    };
    const owner = responsibilityOwner(request, auth.payload, auth.user);
    if (!review) {
      await authorizeResponsibilityReceipt(prisma, actor);
      return NextResponse.json(
        {
          contract: RESPONSIBILITY_RECOVERY,
          enabled:
            responsibilityWritingEnabled() &&
            owner !== null &&
            (await responsibilityStorageAvailable(prisma)),
          owner,
          userId: actor.userId,
          familyId: actor.familyId,
          role: actor.role,
        },
        { headers },
      );
    }
    if (
      !owner ||
      request.headers.get(RESPONSIBILITY_OWNER_HEADER) !== owner.scope
    )
      throw new ResponsibilityError("FORBIDDEN");
    const body = responsibilityRecoveryInput.safeParse(
      JSON.parse(await boundedRequestText(request, 10000)),
    );
    if (!body.success)
      return NextResponse.json(
        { error: { code: "RESPONSIBILITY_INVALID_REQUEST" } },
        { status: 400, headers },
      );
    return NextResponse.json(
      await reviewResponsibilityRequest(
        prisma,
        actor,
        body.data.entry,
        owner.scope,
      ),
      { headers },
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof RequestBodyTooLarge)
      return NextResponse.json(
        { error: { code: "RESPONSIBILITY_INVALID_REQUEST" } },
        { status: error instanceof RequestBodyTooLarge ? 413 : 400, headers },
      );
    const result = responsibilityFailure(error);
    return NextResponse.json(result.body, { status: result.status, headers });
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
