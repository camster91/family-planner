import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  readIdempotencyKey,
  idempotencyError,
  withIdempotency,
} from "@/lib/idempotency";
import {
  ResponsibilityError,
  responsibilityCommand,
} from "@/lib/responsibility";
import {
  responsibilityQuery,
  responsibilityReceipt,
  responsibilityReceiptMatches,
  RESPONSIBILITY_ACTION,
} from "@/lib/responsibility-http-contract";
import { readResponsibilityView } from "@/lib/responsibility-runtime";
import {
  authorizeResponsibilityReceipt,
  writeResponsibility,
  responsibilityFailure,
} from "@/lib/responsibility-server";
import {
  responsibilityOwner,
  responsibilityReady,
  responsibilityWritingEnabled,
} from "@/lib/responsibility-owner";
import { RESPONSIBILITY_OWNER_HEADER } from "@/lib/responsibility-recovery";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const querySchema = responsibilityQuery
  .extend({ q: z.string().trim().max(100).optional() })
  .strict();
async function handle(request: NextRequest, write: boolean) {
  try {
    const [auth, refusal] = await authenticateWithFamily(request);
    if (refusal) {
      refusal.headers.set("Cache-Control", "private, no-store");
      return refusal;
    }
    if (!prisma || !responsibilityReady())
      throw new ResponsibilityError("UNAVAILABLE");
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      tokenVersion: auth.payload.tv ?? 0,
    };
    if (!write) {
      const params = request.nextUrl.searchParams;
      const parsed = querySchema.safeParse(Object.fromEntries(params));
      if (
        new Set(params.keys()).size !== [...params.keys()].length ||
        !parsed.success
      )
        return NextResponse.json(
          { error: { code: "RESPONSIBILITY_INVALID_SCOPE" } },
          { status: 400, headers },
        );
      const { q, ...target } = parsed.data;
      return NextResponse.json(
        { view: await readResponsibilityView(prisma, actor, target, q) },
        { headers },
      );
    }
    const owner = responsibilityOwner(request, auth.payload, auth.user);
    if (
      !responsibilityWritingEnabled() ||
      !owner ||
      request.headers.get(RESPONSIBILITY_OWNER_HEADER) !== owner.scope
    )
      throw new ResponsibilityError("FORBIDDEN");
    const { key, error } = readIdempotencyKey(request);
    if (error) return error;
    if (!key) return idempotencyError("IDEMPOTENCY_KEY_REQUIRED");
    const command = responsibilityCommand.safeParse(
      JSON.parse(await boundedRequestText(request, 4000)),
    );
    if (!command.success)
      return NextResponse.json(
        { error: { code: "RESPONSIBILITY_INVALID_REQUEST" } },
        { status: 400, headers },
      );
    if (
      command.data.userId !== actor.userId ||
      command.data.familyId !== actor.familyId
    )
      throw new ResponsibilityError("FORBIDDEN");
    const response = await withIdempotency(
      prisma,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: RESPONSIBILITY_ACTION,
      },
      command.data,
      async ({ recordId }) => {
        if (!recordId) throw new ResponsibilityError("CONFLICT");
        try {
          return await writeResponsibility(
            prisma!,
            actor,
            command.data,
            key,
            recordId,
          );
        } catch (caught) {
          return responsibilityFailure(caught);
        }
      },
      {
        beforeReplay: async () => {
          try {
            await authorizeResponsibilityReceipt(prisma!, actor);
            return null;
          } catch (caught) {
            return responsibilityFailure(caught);
          }
        },
        transformReplay: async (result) =>
          result.status === 200 &&
          responsibilityReceiptMatches(result.body, command.data, key)
            ? { status: 200, body: responsibilityReceipt.parse(result.body) }
            : responsibilityFailure(new ResponsibilityError("UNSUPPORTED")),
      },
    );
    response.headers.set("Cache-Control", "private, no-store");
    return response;
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
export const PATCH = (request: NextRequest) => handle(request, true);
