import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticateWithFamily } from "@/lib/api-auth";
import { canUseCapture, CAPTURE_CHILD_MESSAGE } from "@/lib/role-capabilities";
import {
  CaptureError,
  resolveCaptureConfig,
  structuredAssistantReply,
} from "@/lib/capture";
import { normalizeFeatures } from "@/lib/features";
import {
  assistantPrompt,
  assistantReplySchema,
  canUseAssistantAction,
} from "@/lib/assistant-actions";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { isAssistantTodayEnabled } from "@/lib/assistant-today-capability";
import {
  AssistantTodayInputError,
  loadAssistantTodayContext,
} from "@/lib/assistant-today-context";
import { assistantTodayContextSchema } from "@/lib/assistant-context-schema";
import type { AssistantTodayTransportContext } from "@/lib/assistant-context-schema";
const schema = z
  .object({
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(2000),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    localNow: z.string().max(80),
    timeZone: z.string().max(100),
    includeToday: z.boolean().optional(),
  })
  .strict();
export const dynamic = "force-dynamic";

function responseHeaders(todayContext: unknown): Record<string, string> {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
  };
  if (!todayContext || typeof todayContext !== "object") return headers;
  const context = todayContext as {
    protocol?: unknown;
    generatedAt?: unknown;
    expiresAt?: unknown;
  };
  if (
    typeof context.protocol === "string" &&
    typeof context.generatedAt === "string" &&
    typeof context.expiresAt === "string"
  ) {
    headers["X-Assistant-Today-Protocol"] = context.protocol;
    headers["X-Assistant-Today-Generated-At"] = context.generatedAt;
    headers["X-Assistant-Today-Expires-At"] = context.expiresAt;
  }
  return headers;
}

export async function POST(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  if (!canUseCapture(auth.user.role))
    return NextResponse.json({ error: CAPTURE_CHILD_MESSAGE }, { status: 403 });
  try {
    const raw = await boundedRequestText(request, 64000);
    if (raw.length > 26000)
      return NextResponse.json({ error: "Chat is too long." }, { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { error: "Invalid chat request" },
        { status: 400 },
      );
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success || parsed.data.messages.at(-1)?.role !== "user")
      return NextResponse.json(
        { error: "Invalid chat request" },
        { status: 400 },
      );
    const includeToday = parsed.data.includeToday === true;
    if (includeToday && !isAssistantTodayEnabled())
      return NextResponse.json(
        {
          error: "Today context is not available yet.",
          code: "ASSISTANT_TODAY_UNAVAILABLE",
        },
        { status: 503 },
      );

    let todayContext: AssistantTodayTransportContext | undefined;
    if (includeToday) {
      const serverNow = new Date();
      const localNow = new Date(parsed.data.localNow);
      try {
        const context = await loadAssistantTodayContext(prisma!, {
          userId: auth.user.id,
          familyId: auth.user.family_id,
          role: auth.user.role,
          serverNow,
          localNow,
          viewerTimeZone: parsed.data.timeZone,
          surface: "person",
        });
        if (!context) {
          return NextResponse.json(
            {
              error: "Today context is unavailable.",
              code: "ASSISTANT_TODAY_UNAVAILABLE",
            },
            { status: 503 },
          );
        }
        const validated = assistantTodayContextSchema.safeParse(context);
        if (!validated.success) {
          return NextResponse.json(
            {
              error: "Today context is unavailable.",
              code: "ASSISTANT_TODAY_UNAVAILABLE",
            },
            { status: 503 },
          );
        }
        todayContext = validated.data;
      } catch (error) {
        if (error instanceof AssistantTodayInputError)
          return NextResponse.json(
            {
              error: "Today context could not be checked.",
              code: "ASSISTANT_TODAY_INPUT_INVALID",
            },
            { status: 400 },
          );
        return NextResponse.json(
          {
            error: "Today context is unavailable.",
            code: "ASSISTANT_TODAY_UNAVAILABLE",
          },
          { status: 503 },
        );
      }
    }

    const family = await prisma!.family.findUnique({
      where: { id: auth.user.family_id },
      select: {
        features: true,
        capture_ai_key_enc: true,
        capture_ai_base_url: true,
        capture_ai_model: true,
      },
    });

    const config = resolveCaptureConfig(family);
    if (!config)
      return NextResponse.json(
        {
          error:
            "AI is not connected yet. Ask a parent to connect the household AI provider.",
        },
        { status: 503 },
      );
    const rate = await checkRateLimit(`assistant:${auth.user.id}`, 30, 3600000);
    if (!rate.allowed)
      return NextResponse.json(
        { error: "Chat limit reached. Try again later." },
        { status: 429 },
      );
    const features = normalizeFeatures(family?.features);
    const chat = {
      messages: parsed.data.messages,
      localNow: parsed.data.localNow,
      timeZone: parsed.data.timeZone,
    };
    const prompt = assistantPrompt(auth.user.role, features, includeToday);
    const result = assistantReplySchema.safeParse(
      todayContext === undefined
        ? await structuredAssistantReply(chat, config, prompt)
        : await structuredAssistantReply(chat, config, prompt, todayContext),
    );
    if (!result.success)
      return NextResponse.json(
        { error: "AI returned an unsupported action. Please rephrase." },
        { status: 502 },
      );
    if (
      result.data.action &&
      !canUseAssistantAction(result.data.action, auth.user.role, features)
    )
      return NextResponse.json(
        {
          reply:
            "That action is unavailable for your role or this household’s enabled features.",
          action: null,
        },
        { headers: responseHeaders(todayContext) },
      );
    return NextResponse.json(result.data, {
      headers: responseHeaders(todayContext),
    });
  } catch (error) {
    if (error instanceof RequestBodyTooLarge)
      return NextResponse.json(
        { error: "Request is too large" },
        { status: 413 },
      );
    return NextResponse.json(
      {
        error:
          error instanceof CaptureError
            ? error.message
            : "Chat failed. Try again shortly.",
      },
      { status: error instanceof CaptureError ? error.status : 500 },
    );
  }
}
