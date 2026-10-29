import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { refusePairedDevice } from "@/lib/device-refusal";
import { prisma } from "@/lib/prisma";
import { apiError, logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { isProfileAccountLinkEnabled } from "@/lib/profile-account-link-gate";
import { storageBackend } from "@/lib/storage-backend";
import { profileLinkCommand } from "@/lib/profile-account-link-contract";
import {
  manageProfileAccountLink,
  ProfileLinkError,
} from "@/lib/profile-account-link";

export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
function fail(request: NextRequest, status: number, code: string) {
  return apiError(
    status,
    `PROFILE_LINK_${code}`,
    "This profile link request could not be completed. Refresh and try again.",
    { requestId: getRequestId(request), shape: "nested", headers },
  );
}
async function handle(request: NextRequest, readOnly: boolean) {
  const refusal = await refusePairedDevice(request);
  if (refusal) {
    for (const [name, value] of Object.entries(headers))
      refusal.headers.set(name, value);
    return refusal;
  }
  const [auth, authError] = await authenticateWithFamily(request);
  if (authError) {
    for (const [name, value] of Object.entries(headers))
      authError.headers.set(name, value);
    return authError;
  }
  if (!isProfileAccountLinkEnabled()) return fail(request, 409, "UNSUPPORTED");
  // Profile/account linking still depends on the Prisma credential bridge.
  // Keep the D1 path explicitly unavailable rather than falling through to a
  // null Prisma client and reporting a misleading 500.
  if (storageBackend() === "d1") return fail(request, 409, "UNSUPPORTED");
  try {
    let body: unknown = { action: "list" };
    if (!readOnly) {
      // Bounded streaming read. A missing/incorrect Content-Length cannot admit
      // unbounded password or token input to JSON.parse.
      if (!request.body) return fail(request, 400, "INVALID");
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 4096) {
          await reader.cancel();
          return fail(request, 413, "INVALID");
        }
        chunks.push(part.value);
      }
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return fail(request, 400, "INVALID");
      }
    }
    const parsed = profileLinkCommand.safeParse(body);
    if (!parsed.success || (!readOnly && parsed.data.action === "list"))
      return fail(request, 400, "INVALID");
    const limited = await checkRateLimit(
      `profile-link:${auth.user.id}:${parsed.data.action === "claim" ? "proof" : "read-write"}`,
      parsed.data.action === "claim" ? 6 : 100,
    );
    if (!limited.allowed) {
      const response = fail(request, 429, "RATE_LIMITED");
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))),
      );
      return response;
    }
    const result = await manageProfileAccountLink(
      prisma!,
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        tokenVersion: auth.payload.tv ?? 0,
      },
      parsed.data,
    );
    return NextResponse.json(
      { ...result, profileAccountLinkSupported: true },
      { headers },
    );
  } catch (error) {
    if (error instanceof ProfileLinkError) {
      const status =
        error.code === "UNAUTHORIZED"
          ? 401
          : error.code === "FORBIDDEN"
            ? 403
            : error.code === "INVALID"
              ? 400
              : 409;
      return fail(request, status, error.code);
    }
    // Only fixed diagnostic text: token/password-bearing request objects and
    // provider/ORM messages must never enter these logs.
    logRouteError(
      "profile account link",
      new Error("Profile link transaction failed"),
      getRequestId(request),
    );
    return fail(request, 500, "FAILED");
  }
}
export const GET = (request: NextRequest) => handle(request, true);
export const POST = (request: NextRequest) => handle(request, false);
