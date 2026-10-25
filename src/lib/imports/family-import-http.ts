import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { IMPORT_OWNER_HEADER, IMPORT_OWNER_PROTOCOL, importOwner, sameImportOwner } from "@/lib/imports/import-owner-contract";
import { sourceDuplicateDiagnostics } from "@/lib/imports/source-identity-validation";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import {
  isFamilyImportSource,
  runFamilyImport,
} from "@/lib/imports/run-family-import";
import { prisma } from "@/lib/prisma";
import { ImportSessionChangedError } from "@/lib/imports/import-authority";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import { HouseholdMemberIdentityConflict } from "@/lib/household-member-lifecycle";
import { RequestBodyTooLargeError, readBoundedText } from "@/lib/bounded-body";

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const scopeSchema = z.object({
  actorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  familyId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
}).strict();
const requestSchema = z.object({
  data: z.unknown(),
  identityMap: z.record(z.string(), z.string().min(1)).default({}),
  dryRun: z.boolean().default(true),
  // Intent precondition only; current authentication remains authoritative.
  reviewProtocol: z.literal(1).optional(),
  expectedScope: scopeSchema.optional(),
});

async function handleFamilyImport(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
  requireOwner: boolean,
) {
  const [auth, authError] = await authenticateWithFamily(request);
  if (authError) return authError;
  const parentError = requireParent(auth.user.role);
  if (parentError) return parentError;

  const originalOwner = { protocol: IMPORT_OWNER_PROTOCOL, actorId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 } as const;
  const rawOwner = request.headers.get(IMPORT_OWNER_HEADER);
  if (requireOwner && rawOwner === null)
    return NextResponse.json({ error: "Original import account context is required", code: "IMPORT_OWNER_REQUIRED" }, { status: 400 });
  if (rawOwner !== null) {
    try {
      if (rawOwner.length > 1024 || !sameImportOwner(importOwner.parse(JSON.parse(rawOwner)), originalOwner)) throw new Error();
    } catch {
      return NextResponse.json({ error: "The original import account or household changed", code: "IMPORT_SCOPE_CHANGED" }, { status: 409 });
    }
  }

  const { source } = await context.params;
  if (!isFamilyImportSource(source)) {
    return NextResponse.json(
      { error: "Unsupported import source" },
      { status: 404 },
    );
  }

  let body: unknown;
  try {
    // Bounded while reading, so a chunked body without Content-Length
    // cannot be buffered past the limit.
    const raw = await readBoundedText(request, MAX_IMPORT_BYTES);
    body = JSON.parse(raw);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Import payload exceeds 10 MB" },
        { status: 413 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid import request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (requireOwner && parsed.data.reviewProtocol !== 1)
    return NextResponse.json({ error: "Review the current household before importing", code: "IMPORT_REVIEW_REQUIRED" }, { status: 400 });

  if (parsed.data.reviewProtocol === 1 && !parsed.data.dryRun && !parsed.data.expectedScope)
    return NextResponse.json({ error: "Review the current household before importing", code: "IMPORT_REVIEW_REQUIRED" }, { status: 400 });
  const expected = parsed.data.expectedScope;
  if (expected && (expected.actorId !== auth.user.id || expected.familyId !== auth.user.family_id))
    return NextResponse.json({ error: "The reviewed account or household changed", code: "IMPORT_SCOPE_CHANGED" }, { status: 409 });

  const mappedUserIds = [...new Set(Object.values(parsed.data.identityMap))];
  if (mappedUserIds.length > 0) {
    const familyUsers = await prisma!.user.findMany({
      where: { id: { in: mappedUserIds }, family_id: auth.user.family_id },
      select: { id: true },
    });
    const familyUserIds = new Set(familyUsers.map((user) => user.id));
    const invalidUserIds = mappedUserIds.filter((id) => !familyUserIds.has(id));
    if (invalidUserIds.length > 0) {
      return NextResponse.json(
        {
          error: "Identity map contains users outside this family",
          invalidUserIds,
        },
        { status: 400 },
      );
    }
  }

  try {
    const result = await runFamilyImport({
      source,
      data: parsed.data.data,
      identityMap: parsed.data.identityMap,
      dryRun: parsed.data.dryRun,
      familyId: auth.user.family_id,
      startedBy: auth.user.id,
      sessionVersion: auth.payload.tv ?? 0,
    });
    if (requireOwner) {
      // Renew the same original actor before returning private preview/receipt.
      // A later refusal does not prove an earlier write rolled back.
      const [current, currentError] = await authenticateWithFamily(request);
      if (currentError) return currentError;
      if (current.user.role !== 'parent' || !sameImportOwner(originalOwner, {
        protocol: IMPORT_OWNER_PROTOCOL, actorId: current.user.id,
        familyId: current.user.family_id, generation: current.payload.tv ?? 0,
      })) return NextResponse.json({ error: "The original import account or household changed", code: "IMPORT_SCOPE_CHANGED" }, { status: 409 });
    }
    return NextResponse.json({
      ...result,
      ...(requireOwner ? { originalOwner } : {}),
      ...(parsed.data.reviewProtocol === 1 ? { review: {
        protocol: 1, actorId: auth.user.id, familyId: auth.user.family_id,
      } } : {}),
    }, {
      status: parsed.data.dryRun ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof ImportSessionChangedError)
      return NextResponse.json({ error: "Unauthorized", code: "SESSION_CHANGED" }, { status: 401 });
    if (error instanceof HouseholdMemberIdentityConflict)
      return NextResponse.json(
        { error: error.message, code: "IDENTITY_CONFLICT" },
        { status: 409 },
      );
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid source export", details: error.flatten(), duplicateSourceIds: sourceDuplicateDiagnostics(error) },
        { status: 400 },
      );
    }
    logRouteError(
      "POST /api/admin/imports/[source]",
      error,
      getRequestId(request),
    );
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}

/** Shared legacy/strict handler. Strict callers never fall back to the old URL. */
export async function postFamilyImport(request: NextRequest, context: { params: Promise<{ source: string }> }, requireOwner = false) {
  const response = await handleFamilyImport(request, context, requireOwner);
  if (requireOwner || request.headers.has(IMPORT_OWNER_HEADER)) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', `Cookie, ${IMPORT_OWNER_HEADER}`);
  }
  return response;
}
