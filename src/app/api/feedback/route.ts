import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
export const dynamic = "force-dynamic";
const schema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(["bug", "feature"]),
    title: z.string().trim().min(3).max(200),
    details: z.string().trim().min(10).max(4000),
    page: z
      .string()
      .regex(/^\/dashboard(?:\/[a-zA-Z0-9_/-]*)?$/)
      .max(300),
  })
  .strict();
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  try {
    const reports = await prisma!.appFeedback.findMany({
      where: { user_id: auth.user.id, family_id: auth.user.family_id },
      orderBy: { created_at: "desc" },
      take: 25,
    });
    return NextResponse.json(
      { reports },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load reports" },
      { status: 500 },
    );
  }
}
export async function POST(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  try {
    const raw = await boundedRequestText(request, 24000);
    if (raw.length > 6000)
      return NextResponse.json(
        { error: "Report is too long" },
        { status: 413 },
      );
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Invalid report" }, { status: 400 });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Add a title and at least 10 characters of detail." },
        { status: 400 },
      );
    const rate = await checkRateLimit(`feedback:${auth.user.id}`, 20, 3600000);
    if (!rate.allowed)
      return NextResponse.json(
        { error: "Report limit reached. Try later." },
        { status: 429 },
      );
    const { requestId, kind, title, details, page } = parsed.data;
    const report = await prisma!.appFeedback.upsert({
      where: {
        user_id_request_id: { user_id: auth.user.id, request_id: requestId },
      },
      update: {},
      create: {
        user_id: auth.user.id,
        family_id: auth.user.family_id,
        request_id: requestId,
        kind,
        title,
        details,
        page,
      },
    });
    // A replay after changing households cannot disclose an earlier report.
    if (report.family_id !== auth.user.family_id)
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    return NextResponse.json(
      { report },
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLarge)
      return NextResponse.json(
        { error: "Request is too large" },
        { status: 413 },
      );
    return NextResponse.json(
      { error: "Could not save report. Try again with the same draft." },
      { status: 500 },
    );
  }
}
