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
  })
  .strict();
export const dynamic = "force-dynamic";
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
    const result = assistantReplySchema.safeParse(
      await structuredAssistantReply(
        parsed.data,
        config,
        assistantPrompt(auth.user.role, features),
      ),
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
        { headers: { "Cache-Control": "private, no-store" } },
      );
    return NextResponse.json(result.data, {
      headers: { "Cache-Control": "private, no-store" },
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
