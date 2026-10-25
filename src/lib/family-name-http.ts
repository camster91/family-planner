import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/bounded-body";
import { updateFamilySchema } from "@/lib/validations";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import { prisma } from "@/lib/prisma";
import { logRouteError } from "@/lib/api-error";
import { getRequestId } from "@/lib/request-id";
const headers = { "Cache-Control": "private, no-store" };
const strictName = z.object({ name_protocol: z.literal(1),
  familyId: z.string().min(1).max(128), name: z.string().trim().min(1).max(100),
  baseName: z.string().max(100),
}).strict();
const refused = (status: number, code: string) => ({ status, body: { error: code, code } });
const display = { id: true, name: true, subscription_tier: true, created_at: true, features: true } as const;
/** Shared legacy/modern writer. Fresh authority and optional name CAS are atomic. */
export async function renameFamilyInTransaction(tx: any,
  input: { familyId: string; name?: string; baseName?: string },
  actor: { userId: string; familyId: string; generation: number },
) {
  if (input.familyId !== actor.familyId) return refused(403, "FORBIDDEN");
  await lockUser(tx, actor.userId);
  await lockHousehold(tx, actor.familyId);
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.userId} FOR SHARE`;
  const current = await tx.user.findUnique({ where: { id: actor.userId }, select: { role: true, family_id: true, token_version: true } });
  if (!current || current.role !== "parent" || current.family_id !== actor.familyId) return refused(403, "FORBIDDEN");
  if (current.token_version !== actor.generation) return refused(401, "SESSION_CHANGED");
  await tx.$queryRaw`SELECT "id" FROM "Family" WHERE "id" = ${actor.familyId} FOR UPDATE`;
  const family = await tx.family.findUnique({ where: { id: actor.familyId }, select: display });
  if (!family) return refused(404, "FAMILY_NOT_FOUND");
  if (input.baseName !== undefined && family.name !== input.baseName && family.name !== input.name)
    return refused(409, "FAMILY_NAME_CHANGED");
  // An uncertain retry whose desired value already exists converges without
  // touching the row again. Legacy no-name/billing-only calls remain no-ops.
  if (!input.name || family.name === input.name) return { status: 200, body: { family } };
  const updated = await tx.family.update({ where: { id: actor.familyId }, data: { name: input.name }, select: display });
  return { status: 200, body: { family: updated } };
}
export async function familyNameHttp(request: NextRequest, strict = false) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) { error.headers.set("Cache-Control", headers["Cache-Control"]); return error; }
    const parent = requireParent(auth.user.role);
    if (parent) { parent.headers.set("Cache-Control", headers["Cache-Control"]); return parent; }
    let body: unknown;
    try { body = await readBoundedJson(request, 8192); }
    catch (error) { return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers }); }
    const parsed = (strict ? strictName : updateFamilySchema).safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid household name" }, { status: 400, headers });
    const input = parsed.data;
    const result = await prisma!.$transaction(tx => renameFamilyInTransaction(tx,
      { familyId: input.familyId, name: input.name, ...(strict ? { baseName: (input as z.infer<typeof strictName>).baseName } : {}) },
      { userId: auth.user.id, familyId: auth.user.family_id, generation: auth.payload.tv ?? 0 }),
      { timeout: 5000, maxWait: 5000 });
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    logRouteError("PATCH family name", error, getRequestId(request));
    return NextResponse.json({ error: "Could not update household" }, { status: 500, headers });
  }
}
