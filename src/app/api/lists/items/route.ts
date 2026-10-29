import { storageBackend } from "@/lib/storage-backend";
import { readD1ListItemsApi } from "@/lib/cloudflare/list-read";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { featureGate } from "@/lib/feature-gate-server";
import { authenticateWithFamily, requireFamilyMatch } from "@/lib/api-auth";
import { isGroceryListType } from "@/lib/grocery-display";
import {
  SECTION_INGREDIENT_SELECT,
  loadSectionOrder,
  loadSectionOverrides,
  sectionsFor,
} from "@/lib/grocery-section-store";
import { DEPRECATED_SINCE_289, markDeprecated } from "@/lib/deprecation";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
import {
  parseListItemPaging,
  afterListItemCursor,
  encodeListItemCursor,
  LIST_ITEM_PAGE_ORDER,
} from "@/lib/list-item-paging";

export const dynamic = "force-dynamic";

// GET /api/lists/items?listId=<id>
// Returns the items of one list (family-scoped). The list index endpoint only
// includes counts, so this is the read side of the items CRUD.
//
// Deprecated (route inventory F-5, #289): no in-app caller (the list page
// reads on the server), only e2e/. Legacy no-limit responses stay unchanged until the ADR-0004 review
// of installed Android clients; every response adds a `Deprecation` header.
export async function GET(request: NextRequest) {
  return markDeprecated(await readListItems(request), {
    since: DEPRECATED_SINCE_289,
  });
}

async function readListItems(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;

    // O-11 (ADR-0007): lists are feature-gated server-side like every other domain.
    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) return gate;

    const listId = request.nextUrl.searchParams.get("listId");
    if (!listId) {
      return NextResponse.json(
        { error: "listId is required" },
        { status: 400 },
      );
    }

    if (storageBackend() === "d1") {
      const paging = parseListItemPaging(request.nextUrl.searchParams, {
        familyId: auth.user.family_id,
        listId,
      });
      if (
        !paging.ok ||
        (paging.paged &&
          request.nextUrl.searchParams.getAll("listId").length > 1)
      )
        return NextResponse.json(
          { error: paging.ok ? "Duplicate listId" : paging.error },
          { status: 400 },
        );
      const result = await readD1ListItemsApi(
        {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          generation: auth.payload?.tv ?? 0,
        },
        listId,
        paging,
      );
      return NextResponse.json(result.body, {
        status: result.status,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const list = await prisma!.list.findUnique({
      where: { id: listId },
      select: { family_id: true, type: true, sort_by_section: true },
    });
    if (!list) {
      return NextResponse.json({ error: "List not found" }, { status: 404 });
    }

    const familyError = requireFamilyMatch(list.family_id, auth.user.family_id);
    if (familyError) return familyError;

    const scope = { familyId: auth.user.family_id, listId };
    const paging = parseListItemPaging(request.nextUrl.searchParams, scope);
    if (
      !paging.ok ||
      (paging.paged && request.nextUrl.searchParams.getAll("listId").length > 1)
    )
      return NextResponse.json(
        { error: paging.ok ? "Duplicate listId" : paging.error },
        { status: 400 },
      );
    const orderBy = paging.paged
      ? LIST_ITEM_PAGE_ORDER
      : [
          { checked: "asc" as const },
          { position: "asc" as const },
          { created_at: "asc" as const },
        ];
    const query = {
      where: {
        list_id: listId,
        ...(paging.paged && paging.cursor
          ? afterListItemCursor(paging.cursor)
          : {}),
      },
      orderBy,
      ...(paging.paged ? { take: paging.limit + 1 } : {}),
    };
    const pageInfo = (
      rows: Array<{ position: number; created_at: Date; id: string }>,
    ) =>
      paging.paged
        ? {
            nextCursor:
              rows.length > paging.limit
                ? encodeListItemCursor(scope, rows[paging.limit - 1])
                : null,
          }
        : {};
    const headers = { "Cache-Control": "private, no-store" };
    if (!isGroceryListType(list.type)) {
      const rows = await prisma!.listItem.findMany(query);
      const items = paging.paged ? rows.slice(0, paging.limit) : rows;
      return NextResponse.json({ items, ...pageInfo(rows) }, { headers });
    }

    // Grocery/shopping lists (#273): every row carries its resolved store
    // `section`, and the response says whether and in which order to group.
    const rows = await prisma!.listItem.findMany({
      ...query,
      include: { ingredient: SECTION_INGREDIENT_SELECT },
    });
    const shown = paging.paged ? rows.slice(0, paging.limit) : rows;
    const sections = sectionsFor(
      shown,
      await loadSectionOverrides(prisma!, auth.user.family_id, shown),
    );
    const items = shown.map(({ ingredient: _ingredient, ...row }, i) => ({
      ...row,
      section: sections[i],
    }));
    const order = await loadSectionOrder(prisma!, auth.user.family_id);
    return NextResponse.json(
      {
        items,
        sectionSort: {
          enabled: list.sort_by_section !== false,
          order: order.order,
          learned: order.learned,
        },
        ...pageInfo(rows),
      },
      { headers },
    );
  } catch (error) {
    logRouteError("GET /api/lists/items", error, getRequestId(request));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
