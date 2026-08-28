import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import {
  isFamilyImportSource,
  runFamilyImport,
} from "@/lib/imports/run-family-import";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const requestSchema = z.object({
  data: z.unknown(),
  identityMap: z.record(z.string(), z.string().min(1)).default({}),
  dryRun: z.boolean().default(true),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  const [auth, authError] = await authenticateWithFamily(request);
  if (authError) return authError;
  const parentError = requireParent(auth.user.role);
  if (parentError) return parentError;

  const { source } = await context.params;
  if (!isFamilyImportSource(source)) {
    return NextResponse.json(
      { error: "Unsupported import source" },
      { status: 404 },
    );
  }

  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_IMPORT_BYTES) {
    return NextResponse.json(
      { error: "Import payload exceeds 10 MB" },
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { error: "Import payload exceeds 10 MB" },
        { status: 413 },
      );
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid import request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

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
    });
    return NextResponse.json(result, {
      status: parsed.data.dryRun ? 200 : 201,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid source export", details: error.flatten() },
        { status: 400 },
      );
    }
    console.error(`Failed ${source} import:`, error);
    return NextResponse.json({ error: "Import failed" }, { status: 500 });
  }
}
