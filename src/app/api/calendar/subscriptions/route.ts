import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { encryptSecret } from "@/lib/secret-box";
import { assertPublicProviderUrl } from "@/lib/outbound-url";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  checkFeedUrlShape,
  normalizeFeedUrl,
} from "@/lib/calendar-import/fetch";
import {
  MAX_SUBSCRIPTIONS_PER_FAMILY,
  toSubscriptionDto,
} from "@/lib/calendar-import/sync";

export const dynamic = "force-dynamic";

// Read-only ICS calendar subscriptions (#232). See docs/architecture/CALENDAR_IMPORT.md.
// The feed URL is write-only: after saving it is never returned or logged.

const subscriptionColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Colour must look like #1a2b3c")
  .nullable()
  .optional();

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the calendar a name")
    .max(60, "Name is too long"),
  url: z
    .string()
    .trim()
    .min(1, "Paste the calendar link")
    .max(2048, "That link is too long"),
  color: subscriptionColorSchema,
});

const SUB_SELECT = {
  id: true,
  name: true,
  color: true,
  url_enc: true,
  last_fetched_at: true,
  last_status: true,
  last_error: true,
  created_at: true,
} as const;

// GET /api/calendar/subscriptions — parents and teens (teens may refresh).
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const role = auth.user.role;
    if (role !== "parent" && role !== "teen") {
      return NextResponse.json(
        { error: "Only parents and teens can view calendar subscriptions" },
        { status: 403 },
      );
    }

    const subs = await prisma!.calendarSubscription.findMany({
      where: { family_id: auth.user.family_id },
      select: SUB_SELECT,
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
      take: MAX_SUBSCRIPTIONS_PER_FAMILY,
    });
    return NextResponse.json({
      subscriptions: subs.map((s) =>
        toSubscriptionDto(s, { includeUrlHint: role === "parent" }),
      ),
    });
  } catch {
    console.error("Error listing calendar subscriptions");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/calendar/subscriptions — parents only. Body: { name, url, color? }
export async function POST(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const parentError = requireParent(auth.user.role);
    if (parentError) return parentError;

    const limit = await checkRateLimit(
      `calsub-create:${auth.user.family_id}`,
      10,
      60 * 60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many calendar changes. Try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)),
          },
        },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const shapeError = checkFeedUrlShape(parsed.data.url);
    const url = normalizeFeedUrl(parsed.data.url);
    if (shapeError || !url) {
      return NextResponse.json(
        { error: shapeError ?? "That calendar link is not valid" },
        { status: 400 },
      );
    }
    try {
      await assertPublicProviderUrl(url);
    } catch {
      return NextResponse.json(
        { error: "Calendar links must point to a public address" },
        { status: 400 },
      );
    }

    const count = await prisma!.calendarSubscription.count({
      where: { family_id: auth.user.family_id },
    });
    if (count >= MAX_SUBSCRIPTIONS_PER_FAMILY) {
      return NextResponse.json(
        {
          error: `A household can subscribe to at most ${MAX_SUBSCRIPTIONS_PER_FAMILY} calendars`,
        },
        { status: 409 },
      );
    }

    const created = await prisma!.calendarSubscription.create({
      data: {
        family_id: auth.user.family_id,
        name: parsed.data.name,
        url_enc: encryptSecret(url),
        color: parsed.data.color ?? null,
        last_status: "pending",
        created_by: auth.user.id,
      },
      select: SUB_SELECT,
    });

    return NextResponse.json(
      { subscription: toSubscriptionDto(created, { includeUrlHint: true }) },
      { status: 201 },
    );
  } catch {
    // Never log the error object: it could echo the submitted URL.
    console.error("Error creating calendar subscription");
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
