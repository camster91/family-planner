import { deleteD1List } from "@/lib/cloudflare/list-delete";
import { D1PersonReceiptError } from "@/lib/cloudflare/person-effect";
import { idempotencyError } from "@/lib/idempotency";
import { storageBackend } from "@/lib/storage-backend";
import { readD1ListIndex } from "@/lib/cloudflare/list-read";
import {
  assistantSourceGuard,
  AssistantSourceRefused,
} from "@/lib/assistant-source-proof";
import { assistantDeleteTargetGuard } from "@/lib/assistant-delete-target";
import {
  deletePersonRecord,
  authorizePersonDeleteReplay,
} from "@/lib/person-record-delete";
import { readIdempotencyKey, withIdempotency } from "@/lib/idempotency";
import { withRouteTelemetry } from "@/lib/route-telemetry";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { featureGate } from "@/lib/feature-gate-server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { deleteListSchema } from "@/lib/validations";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  parseListPaging,
  encodeListCursor,
  afterListCursor,
} from "@/lib/list-paging";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

export const GET = withRouteTelemetry("/api/lists", handleGET);

async function handleGET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) return gate;

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || null;
    const scope = { familyId: auth.user.family_id, type };
    const paging = parseListPaging(searchParams, scope);
    if (!paging.ok)
      return NextResponse.json({ error: paging.error }, { status: 400 });

    if (storageBackend() === "d1") {
      const result = await readD1ListIndex(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload?.tv ?? 0,
        },
        type,
        paging,
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const where: Prisma.ListWhereInput = {
      family_id: auth.user.family_id,
      ...(paging.paged && paging.cursor ? afterListCursor(paging.cursor) : {}),
    };
    if (type) {
      where.type = type;
    }

    const rows = await prisma!.list.findMany({
      where,
      include: {
        _count: { select: { items: true } },
        creator: { select: { name: true } },
      },
      // Stable creation order prevents item checks/renames moving a list across
      // an opted-in page boundary. Legacy callers retain updated-first order.
      orderBy: paging.paged
        ? [{ created_at: "desc" }, { id: "asc" }]
        : { updated_at: "desc" },
      ...(paging.paged ? { take: paging.limit + 1 } : {}),
    });

    const lists = paging.paged ? rows.slice(0, paging.limit) : rows;
    return NextResponse.json(
      paging.paged
        ? {
            lists,
            nextCursor:
              rows.length > paging.limit
                ? encodeListCursor(scope, lists[lists.length - 1])
                : null,
          }
        : { lists },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    logRouteError("GET /api/lists", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE - Delete a list (family-scoped, cascade deletes items)
export async function DELETE(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) return gate;

    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = deleteListSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "listId is required" },
        { status: 400 },
      );
    }

    const { key, error: keyError } = readIdempotencyKey(request);
    if (keyError) return keyError;
    const actor = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload?.tv ?? 0,
    };
    const kind = "list_delete" as const;
    const sourceGuard = assistantSourceGuard(request, actor, kind);
    const targetGuard = assistantDeleteTargetGuard(
      request,
      actor,
      kind,
      parsed.data.listId,
      Boolean(sourceGuard),
    );
    if (storageBackend() === "d1") {
      const result = await deleteD1List(actor, parsed.data.listId, key, {
        sourceGuard,
        targetGuard,
      });
      return NextResponse.json(result.body, {
        status: result.status,
        headers: result.replayed
          ? { "Idempotency-Replayed": "true" }
          : undefined,
      });
    }
    return await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${actor.userId}`,
        userId: actor.userId,
        familyId: actor.familyId,
        action: "list.delete",
      },
      parsed.data,
      ({ recordId }) =>
        deletePersonRecord(
          prisma!,
          actor,
          kind,
          parsed.data.listId,
          recordId,
          sourceGuard,
          targetGuard,
        ),
      { beforeReplay: () => authorizePersonDeleteReplay(prisma!, actor, kind) },
    );
  } catch (error) {
    if (error instanceof D1PersonReceiptError)
      return idempotencyError(error.code);
    if (error instanceof AssistantSourceRefused) return error.response();
    logRouteError("DELETE /api/lists", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
