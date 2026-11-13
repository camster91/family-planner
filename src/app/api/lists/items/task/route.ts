import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { featureGate } from "@/lib/feature-gate-server";
import { storageBackend } from "@/lib/storage-backend";
import { LIST_TASKS_UNSUPPORTED, isDueDay, listTasksReady } from "@/lib/list-tasks";
import { setListItemTask } from "@/lib/list-tasks-db";
import { setD1ListItemTask } from "@/lib/cloudflare/list-tasks";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };
const patchSchema = z.object({
  itemId: z.string().min(1).max(128),
  owner: z.object({ kind: z.enum(["account", "profile"]), id: z.string().min(1).max(128) }).strict().nullable().optional(),
  due: z.string().refine(isDueDay, { message: "Use a real date" }).nullable().optional(),
}).strict().refine((value) => value.owner !== undefined || value.due !== undefined, { message: "Send owner or due" });

/**
 * PATCH /api/lists/items/task { itemId, owner?, due? } - who a to-do is for
 * and when it is due (default-off). A field left out is unchanged; null clears
 * it. Explicit values, so a repeat converges. Parents and teens only, like
 * creating a list; grocery and shopping lists are refused.
 */
export async function PATCH(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const gate = await featureGate(auth.user.family_id, "lists");
    if (gate) return gate;
    if (!listTasksReady()) return NextResponse.json(LIST_TASKS_UNSUPPORTED.body, { status: LIST_TASKS_UNSUPPORTED.status, headers: NO_STORE });
    let input: unknown;
    try { input = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE }); }
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400, headers: NO_STORE });
    const actor = { familyId: auth.user.family_id, role: auth.user.role, generation: auth.payload.tv ?? 0 };
    const result = storageBackend() === "d1"
      ? await setD1ListItemTask({ ...actor, userId: auth.user.id }, parsed.data)
      : await setListItemTask(prisma!, { ...actor, addedBy: auth.user.id }, parsed.data);
    return NextResponse.json(result.body, { status: result.status, headers: NO_STORE });
  } catch (error) {
    logRouteError("PATCH /api/lists/items/task", error, getRequestId(request));
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
