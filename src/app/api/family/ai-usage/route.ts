import { readFoodAiFeedbackCounts } from "@/lib/food-planning/ai-feedback";
import { readD1FoodAiFeedbackCounts } from "@/lib/cloudflare/food-ai-feedback";
import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { lockUser, lockHousehold } from "@/lib/household-lock";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import {
  aiUsagePolicyCommand,
  aiUsageReport,
  AI_USAGE_FEEDBACK_HEADER,
  AI_USAGE_FEEDBACK_PROTOCOL,
} from "@/lib/ai-usage-contract";
import {
  AiUsageError,
  isAiUsageAdopted,
  isAiUsageReady,
  aiUsageStorageAvailable,
  readAiUsagePolicy,
  readAiUsageDays,
  saveAiUsagePolicy,
  aiConfigHash,
} from "@/lib/ai-usage-server";
import { resolveCaptureConfig } from "@/lib/capture";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import {
  d1AiUsageStorageAvailable,
  readD1AiUsageDays,
  readD1AiUsagePolicy,
  saveD1AiUsagePolicy,
} from "@/lib/cloudflare/ai-usage";
export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
async function run(request: NextRequest, write: boolean) {
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) {
      error.headers.set("Cache-Control", "private, no-store");
      return error;
    }
    const parent = requireParent(auth.user.role);
    if (parent) {
      parent.headers.set("Cache-Control", "private, no-store");
      return parent;
    }
    if (!isAiUsageAdopted())
      return reply({ error: "AI usage is unavailable" }, 404);
    if (write && !isAiUsageReady())
      return reply({ error: "AI usage changes are paused" }, 503);
    let command: ReturnType<typeof aiUsagePolicyCommand.parse> | undefined;
    if (write) {
      try {
        command = aiUsagePolicyCommand.parse(
          JSON.parse(await boundedRequestText(request, 8192)),
        );
      } catch (error) {
        return reply(
          { error: "Invalid AI limit settings" },
          error instanceof RequestBodyTooLarge ? 413 : 400,
        );
      }
    }
    const feedbackRequested =
      request.headers.get(AI_USAGE_FEEDBACK_HEADER) ===
      AI_USAGE_FEEDBACK_PROTOCOL;
    if (storageBackend() === "d1")
      return runD1(request, auth, command, write, feedbackRequested);
    const result = await prisma!.$transaction(async (tx) => {
      await lockUser(tx, auth.user.id);
      await lockHousehold(tx, auth.user.family_id);
      const current = await tx.user.findUnique({
        where: { id: auth.user.id },
        select: { role: true, family_id: true, token_version: true },
      });
      if (!current || current.token_version !== (auth.payload?.tv ?? 0))
        return { status: 401, body: { error: "AI settings session changed" } };
      if (
        current.role !== "parent" ||
        current.family_id !== auth.user.family_id
      )
        return { status: 403, body: { error: "AI settings unavailable" } };
      const owner = {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        generation: current.token_version,
      };
      if (
        command &&
        (command.owner.userId !== owner.userId ||
          command.owner.familyId !== owner.familyId ||
          command.owner.generation !== owner.generation)
      )
        return {
          status: 409,
          body: {
            error: "AI settings owner changed",
            code: "AI_USAGE_OWNER_CHANGED",
          },
        };
      if (!(await aiUsageStorageAvailable(tx)))
        return {
          status: 503,
          body: { error: "AI usage storage is unavailable" },
        };
      const family = await tx.family.findUnique({
        where: { id: owner.familyId },
        select: {
          capture_ai_key_enc: true,
          capture_ai_base_url: true,
          capture_ai_model: true,
          beta_metrics_enabled: true,
        },
      });
      if (!family)
        return { status: 403, body: { error: "AI settings unavailable" } };
      const config = resolveCaptureConfig(family);
      if (command) {
        if (!isAiUsageReady())
          return {
            status: 503,
            body: { error: "AI usage changes are paused" },
          };
        if (command.configVersion !== (config ? aiConfigHash(config) : null))
          return {
            status: 409,
            body: {
              error:
                "The AI provider changed. Refresh and review rates before saving.",
            },
          };
        if (
          command.policy.monthlyBudgetMicrousd !== null &&
          (command.policy.inputRateMicrousdPerMillion === null || !config)
        )
          return {
            status: 400,
            body: {
              error:
                "A cost limit needs the current provider and both token rates",
            },
          };
        const revision = await saveAiUsagePolicy(
          tx,
          owner.familyId,
          command.expectedRevision,
          command.policy,
          config,
        );
        if (revision === null)
          return {
            status: 409,
            body: { error: "AI limits changed. Refresh before saving again." },
          };
      }
      const saved = await readAiUsagePolicy(tx, owner.familyId);
      let host = "Configured provider";
      try {
        if (config) host = new URL(config.baseUrl).hostname.slice(0, 253);
      } catch {
        /* A malformed legacy provider is not a label or action authority. */
      }
      const providerLabel = config
        ? `${host} · ${config.model.slice(0, 256)}`
        : null;
      const now = new Date();
      return {
        status: 200,
        body: aiUsageReport.parse({
          owner,
          ready: isAiUsageReady(),
          providerLabel,
          providerPaused:
            !isAiUsageReady() ||
            process.env.FAMILY_AI_PROVIDER_DISABLED === "1" ||
            !saved.policy.enabled,
          revision: saved.revision,
          policy: saved.policy,
          pricingCurrent: Boolean(
            config && saved.pricedConfigHash === aiConfigHash(config),
          ),
          configVersion: config ? aiConfigHash(config) : null,
          suggestionFeedback:
            feedbackRequested && family.beta_metrics_enabled
              ? await readFoodAiFeedbackCounts(tx, owner.familyId, now)
              : null,
          days: await readAiUsageDays(tx, owner.familyId, now),
          month: now.toISOString().slice(0, 7),
          today: now.toISOString().slice(0, 10),
        }),
      };
    });
    if (
      result.status === 200 &&
      !feedbackRequested &&
      "suggestionFeedback" in result.body
    ) {
      const { suggestionFeedback, ...legacy } = result.body;
      void suggestionFeedback;
      return reply(legacy, result.status);
    }
    return reply(result.body, result.status);
  } catch (error) {
    return reply(
      {
        error:
          error instanceof AiUsageError
            ? error.message
            : "AI usage is unavailable. Try again later.",
      },
      error instanceof AiUsageError ? error.status : 503,
    );
  }
}

type D1UsageAuth = {
  user: {
    id: string;
    family_id: string;
    role: string;
  };
  payload?: { tv?: number };
};

async function runD1(
  request: NextRequest,
  auth: D1UsageAuth,
  command: ReturnType<typeof aiUsagePolicyCommand.parse> | undefined,
  write: boolean,
  feedbackRequested: boolean,
) {
  const db = await getD1Database();
  const current = await db
    .withSession("first-primary")
    .prepare(
      `SELECT u.role,u.family_id,u.token_version,
        f.capture_ai_key_enc,f.capture_ai_base_url,f.capture_ai_model,f.beta_metrics_enabled
       FROM "User" u JOIN "Family" f ON f.id=u.family_id WHERE u.id=?1`,
    )
    .bind(auth.user.id)
    .first<{
      role: string;
      family_id: string | null;
      token_version: number;
      capture_ai_key_enc: string | null;
      capture_ai_base_url: string | null;
      capture_ai_model: string | null;
      beta_metrics_enabled: number;
    }>();
  if (!current || current.token_version !== (auth.payload?.tv ?? 0))
    return reply({ error: "AI settings session changed" }, 401);
  if (current.role !== "parent" || current.family_id !== auth.user.family_id)
    return reply({ error: "AI settings unavailable" }, 403);
  const owner = {
    userId: auth.user.id,
    familyId: auth.user.family_id,
    generation: current.token_version,
  };
  if (
    command &&
    (command.owner.userId !== owner.userId ||
      command.owner.familyId !== owner.familyId ||
      command.owner.generation !== owner.generation)
  )
    return reply(
      {
        error: "AI settings owner changed",
        code: "AI_USAGE_OWNER_CHANGED",
      },
      409,
    );
  if (!(await d1AiUsageStorageAvailable(db)))
    return reply({ error: "AI usage storage is unavailable" }, 503);
  const family = {
    capture_ai_key_enc: current.capture_ai_key_enc,
    capture_ai_base_url: current.capture_ai_base_url,
    capture_ai_model: current.capture_ai_model,
  };
  const config = resolveCaptureConfig(family);
  if (command) {
    if (!isAiUsageReady())
      return reply({ error: "AI usage changes are paused" }, 503);
    if (command.configVersion !== (config ? aiConfigHash(config) : null))
      return reply(
        {
          error:
            "The AI provider changed. Refresh and review rates before saving.",
        },
        409,
      );
    if (
      command.policy.monthlyBudgetMicrousd !== null &&
      (command.policy.inputRateMicrousdPerMillion === null || !config)
    )
      return reply(
        {
          error: "A cost limit needs the current provider and both token rates",
        },
        400,
      );
    const revision = await saveAiUsagePolicy(
      db,
      owner.familyId,
      command.expectedRevision,
      command.policy,
      config,
    );
    if (revision === null)
      return reply(
        { error: "AI limits changed. Refresh before saving again." },
        409,
      );
  }
  const saved = await readD1AiUsagePolicy(db, owner.familyId);
  let host = "Configured provider";
  try {
    if (config) host = new URL(config.baseUrl).hostname.slice(0, 253);
  } catch {
    /* A malformed legacy provider is not a label or action authority. */
  }
  const now = new Date();
  const body = aiUsageReport.parse({
    owner,
    ready: isAiUsageReady(),
    providerLabel: config ? `${host} · ${config.model.slice(0, 256)}` : null,
    providerPaused:
      !isAiUsageReady() ||
      process.env.FAMILY_AI_PROVIDER_DISABLED === "1" ||
      !saved.policy.enabled,
    revision: saved.revision,
    policy: saved.policy,
    pricingCurrent: Boolean(
      config && saved.pricedConfigHash === aiConfigHash(config),
    ),
    configVersion: config ? aiConfigHash(config) : null,
    suggestionFeedback:
      feedbackRequested && current.beta_metrics_enabled
        ? await readD1FoodAiFeedbackCounts(db, owner.familyId, now)
        : null,
    days: await readD1AiUsageDays(db, owner.familyId, now),
    month: now.toISOString().slice(0, 7),
    today: now.toISOString().slice(0, 10),
  });
  if (!feedbackRequested) {
    const { suggestionFeedback, ...legacy } = body;
    void suggestionFeedback;
    return reply(legacy);
  }
  return reply(body);
}
export const GET = (request: NextRequest) => run(request, false);
export const POST = (request: NextRequest) => run(request, true);
