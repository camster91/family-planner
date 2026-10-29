import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { storageBackend } from "@/lib/storage-backend";
import { readD1ImportJobs } from "@/lib/cloudflare/finance-archive";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const [auth, authError] = await authenticateWithFamily(request);
  if (authError) return authError;
  const parentError = requireParent(auth.user.role);
  if (parentError) return parentError;

  if (storageBackend() === "d1") {
    const result = await readD1ImportJobs({
      userId: auth.user.id,
      familyId: auth.user.family_id,
      role: auth.user.role,
      generation: auth.payload.tv ?? 0,
    });
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "private, no-store" } });
  }

  const jobs = await prisma!.importJob.findMany({
    where: { family_id: auth.user.family_id },
    orderBy: { started_at: "desc" },
    take: 50,
    select: {
      id: true,
      source_app: true,
      source_version: true,
      status: true,
      dry_run: true,
      started_at: true,
      completed_at: true,
      summary: true,
      error: true,
    },
  });
  return NextResponse.json({ jobs });
}
