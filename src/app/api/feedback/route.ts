import { FEEDBACK_VIEW_HEADER, FEEDBACK_SUMMARY_VIEW } from "@/lib/feedback-response-contract";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { lockUser, lockHousehold } from "@/lib/household-lock";
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
const summaryFields = { id: true, kind: true, title: true, status: true, created_at: true } as const;
function wantsSummary(request: NextRequest) {
  return request.headers?.get(FEEDBACK_VIEW_HEADER) === FEEDBACK_SUMMARY_VIEW;
}
function reportSummary(report: { id: string; kind: string; title: string; status: string; created_at: Date }) {
  return { id: report.id, kind: report.kind, title: report.title, status: report.status, created_at: report.created_at };
}
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  try {
    const reports = await prisma!.appFeedback.findMany({
      where: { user_id: auth.user.id, family_id: auth.user.family_id },
      orderBy: [{ created_at: "desc" }, { id: "asc" }],
      take: 25,
      ...(wantsSummary(request) ? { select: summaryFields } : {}),
    });
    return NextResponse.json(
      { reports: wantsSummary(request) ? reports.map(reportSummary) : reports },
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
    const result = await prisma!.$transaction(async (tx) => {
      await lockUser(tx, auth.user.id);
      await lockHousehold(tx, auth.user.family_id);
      const member = await tx.user.findFirst({
        where: { id: auth.user.id, family_id: auth.user.family_id },
        select: { token_version: true },
      });
      if (!member || member.token_version !== (auth.payload.tv ?? 0))
        return { kind: "unauthorized" } as const;
      const report = await tx.appFeedback.upsert({
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
      // Never reveal an old household's receipt or silently acknowledge a
      // different draft when a caller reuses a request ID.
      if (report.family_id !== auth.user.family_id)
        return { kind: "not-found" } as const;
      if (
        report.kind !== kind ||
        report.title !== title ||
        report.details !== details ||
        report.page !== page
      )
        return { kind: "conflict" } as const;
      return { kind: "saved", report } as const;
    });
    if (result.kind === "unauthorized")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (result.kind === "not-found")
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    if (result.kind === "conflict")
      return NextResponse.json(
        {
          error:
            "This request ID belongs to a different report. Review your draft before sending a new report.",
          code: "REPORT_REQUEST_CONFLICT",
        },
        { status: 409 },
      );
    const report = result.report;
    return NextResponse.json(
      { report: wantsSummary(request) ? reportSummary(report) : report },
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
