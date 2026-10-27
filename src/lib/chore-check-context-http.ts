import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { choreCheckCommandSchema, choreCheckCommandsEnabled, choreCheckOwnerMatches } from "@/lib/chore-check-command";
import { CHORE_CHECK_COMMAND_PROTOCOL, CHORE_CHECK_OWNER_HEADER, choreCheckVersion } from "@/lib/chore-check-command-shared";
import { renewChoreCheckOwner } from "@/lib/chore-check-owner";
import { readCanonicalChoreDetail } from "@/lib/chore-detail-read";
import { memberIdentityIdSchema } from "@/lib/member-subject-contract";
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, code: string) => NextResponse.json({ error: code, code }, { status, headers });
export async function readChoreCheckContext(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) { error.headers.set("Cache-Control", headers["Cache-Control"]); return error; }
    const parent = requireParent(auth.user.role);
    if (parent) { parent.headers.set("Cache-Control", headers["Cache-Control"]); return parent; }
    if (!choreCheckCommandsEnabled()) return fail(503, "CHORE_CHECK_UNAVAILABLE");
    const raw = request.headers.get(CHORE_CHECK_OWNER_HEADER);
    let owner;
    try { owner = raw && raw.length <= 1024 ? choreCheckCommandSchema.shape.owner.parse(JSON.parse(raw)) : null; }
    catch { return fail(400, "CHORE_CHECK_INVALID"); }
    if (!owner || !choreCheckOwnerMatches(owner, { userId: auth.user.id, familyId: auth.user.family_id, role: auth.user.role, tokenVersion: auth.payload.tv ?? 0 })) return fail(409, "CHORE_CHECK_OWNER_CHANGED");
    const params = new URL(request.url).searchParams;
    const id = memberIdentityIdSchema.safeParse(params.get("choreId"));
    if (!id.success || params.getAll("choreId").length !== 1 || [...params.keys()].some(key => key !== "choreId")) return fail(400, "CHORE_CHECK_INVALID");
    if (!await renewChoreCheckOwner(prisma!, owner)) return fail(409, "CHORE_CHECK_OWNER_CHANGED");
    const response = await readCanonicalChoreDetail(id.data, owner.familyId, request);
    const body = response.ok ? await response.json() as { chore?: Record<string, unknown> } : null;
    if (!await renewChoreCheckOwner(prisma!, owner)) return fail(409, "CHORE_CHECK_OWNER_CHANGED");
    if (!response.ok && response.status !== 404) return fail(response.status, "CHORE_CHECK_READ_UNAVAILABLE");
    const chore = body?.chore ?? null;
    if (chore && (chore.id !== id.data || chore.family_id !== owner.familyId)) return fail(409, "CHORE_CHECK_READ_UNAVAILABLE");
    return NextResponse.json({ protocol: CHORE_CHECK_COMMAND_PROTOCOL, owner, chore,
      version: chore ? choreCheckVersion({ status: chore.status, responsibility_generation: chore.responsibility_generation,
        responsibility_epoch: chore.responsibility_epoch, preparation_epoch: chore.preparation_epoch }) : null }, { headers });
  } catch { return fail(503, "CHORE_CHECK_READ_UNAVAILABLE"); }
}
