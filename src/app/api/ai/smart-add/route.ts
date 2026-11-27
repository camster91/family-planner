import { NextRequest, NextResponse } from "next/server";
import { authenticateWithFamily } from "@/lib/api-auth";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { RequestBodyTooLargeError, readBoundedJson } from "@/lib/bounded-body";
import { isValidTimeZone } from "@/lib/calendar-import/timezone";
import { eventPeopleReady } from "@/lib/event-participants";
import { AiUsageError } from "@/lib/ai-usage-errors";
import { CAPTURE_CHILD_MESSAGE } from "@/lib/role-capabilities";
import { canUseManagedAi, claudeAiDeploymentReady } from "@/lib/ai/flags";
import { readHouseholdAiSetting } from "@/lib/ai/household-setting";
import { loadSmartAddHousehold } from "@/lib/ai/household-data";
import { SMART_ADD_FEATURE } from "@/lib/ai/registry";
import {
  providerFor,
  runManagedFeature,
  type ManagedRun,
} from "@/lib/ai/service";
import { AiProviderError } from "@/lib/ai/provider";
import { describeError, log } from "@/lib/logger";
import {
  aliasSmartAddText,
  aliasedListNames,
  buildSmartAddUserTurn,
  normalizeSmartAdd,
  smartAddRequest,
  type SmartAddProviderOutput,
} from "@/lib/ai/smart-add";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const MAX_BODY_BYTES = 8 * 1024;
const PER_USER_PER_HOUR = 30;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers });
}

function db() {
  return storageBackend() === "d1" ? getD1Database() : Promise.resolve(prisma!);
}

/** The viewer's date must be a real day within one day of the server's UTC date. */
function plausibleLocalDate(value: string, now = new Date()): boolean {
  const server = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const day = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(day) && Math.abs(day - server) <= 86_400_000;
}

/**
 * GET /api/ai/smart-add — may this person use the smart Add box right now?
 * Only `available` (and a reason code when not): never provider, key, model
 * or cost details. Children, paired tablets (refused by authentication), a
 * deployment without Claude, and a household that has not opted in all get
 * `available: false`, and the browser keeps the ordinary buttons.
 */
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) {
    error.headers.set("Cache-Control", "private, no-store");
    return error;
  }
  if (!canUseManagedAi(auth.user.role))
    return json({ available: false, reason: "ROLE" });
  if (!claudeAiDeploymentReady())
    return json({ available: false, reason: "OFF" });
  const setting = await readHouseholdAiSetting(await db(), auth.user.family_id);
  if (!setting.enabled)
    return json({ available: false, reason: "HOUSEHOLD_OFF" });
  return json({ available: true });
}

/**
 * POST /api/ai/smart-add — turn one typed line into draft rows. Returns
 * PROPOSALS only; every row is saved later, after review, through the
 * existing canonical create routes. Nothing is written here except the
 * content-free usage reservation.
 */
export async function POST(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) {
    error.headers.set("Cache-Control", "private, no-store");
    return error;
  }
  if (!canUseManagedAi(auth.user.role))
    return json({ error: CAPTURE_CHILD_MESSAGE, code: "AI_ROLE" }, 403);
  if (!claudeAiDeploymentReady())
    return json({ error: "Smart Add is not available.", code: "AI_OFF" }, 404);
  const store = await db();
  const setting = await readHouseholdAiSetting(store, auth.user.family_id);
  if (!setting.enabled)
    return json(
      {
        error:
          "Smart helpers are off for this household. A parent can turn them on in Settings.",
        code: "AI_HOUSEHOLD_OFF",
      },
      403,
    );

  const rate = await checkRateLimit(
    `smart-add:${auth.user.id}`,
    PER_USER_PER_HOUR,
    60 * 60 * 1000,
  );
  if (!rate.allowed)
    return json(
      {
        error:
          "Too many tries this hour. Use the buttons below, or try again later.",
        code: "RATE_LIMITED",
      },
      429,
    );

  let raw: unknown;
  try {
    raw = await readBoundedJson(request, MAX_BODY_BYTES);
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError)
      return json({ error: "That is too long.", code: "TOO_LONG" }, 413);
    return json({ error: "Invalid JSON", code: "INVALID" }, 400);
  }
  const parsed = smartAddRequest.safeParse(raw);
  if (
    !parsed.success ||
    !isValidTimeZone(parsed.data.timeZone) ||
    !plausibleLocalDate(parsed.data.localDate)
  )
    return json(
      { error: "Type up to 1,000 characters and try again.", code: "INVALID" },
      400,
    );
  const input = parsed.data;

  const actor = {
    userId: auth.user.id,
    familyId: auth.user.family_id,
    role: auth.user.role,
    generation: auth.payload?.tv ?? 0,
  };
  const provider = providerFor(SMART_ADD_FEATURE);
  if (!provider)
    return json({ error: "Smart Add is not available.", code: "AI_OFF" }, 404);

  // Minimize and alias on our server before anything leaves it.
  const household = await loadSmartAddHousehold(store, actor.familyId);
  const aliasedText = aliasSmartAddText(input.text, household);
  const user = buildSmartAddUserTurn({
    aliasedText,
    request: input,
    table: household.table,
    listNames: aliasedListNames(household),
  });

  let run: ManagedRun<SmartAddProviderOutput>;
  try {
    run = await runManagedFeature({
      db: store,
      actor,
      feature: SMART_ADD_FEATURE,
      provider,
      user,
      signal: request.signal,
    });
  } catch (e) {
    if (e instanceof AiUsageError)
      return json({ error: e.message, code: e.code }, e.status);
    if (e instanceof AiProviderError) {
      log.warn("ai.smart_add_provider", {
        code: e.code,
        upstreamStatus: e.upstreamStatus,
      });
      return json(
        {
          error:
            e.code === "AI_PROVIDER_BAD_OUTPUT"
              ? "Smart Add could not read that. Try different words, or use the buttons below."
              : "Smart Add is not responding right now. Use the buttons below, or try again in a minute.",
          code: e.code,
        },
        e.code === "AI_PROVIDER_BAD_OUTPUT" ? 502 : 503,
      );
    }
    log.warn("ai.smart_add_failed", describeError(e));
    return json(
      { error: "Smart Add failed. Use the buttons below.", code: "AI_FAILED" },
      500,
    );
  }

  // Every path below settles the run. If something throws first (a lost
  // database read during the re-check, say), still settle it so the full
  // reservation does not keep counting against the monthly cap. Settling a
  // second time is a no-op.
  try {
    // The household or person may have changed during the call: re-check before replying.
    const [current, refusal] = await authenticateWithFamily(request);
    const latest = refusal
      ? null
      : await readHouseholdAiSetting(store, actor.familyId);
    if (
      refusal ||
      current.user.id !== actor.userId ||
      current.user.family_id !== actor.familyId ||
      current.user.role !== actor.role ||
      (current.payload?.tv ?? 0) !== actor.generation ||
      !canUseManagedAi(current.user.role) ||
      !latest?.enabled
    ) {
      await run.settle(409);
      return json(
        {
          error:
            "Your account or household settings changed. Please try again.",
          code: "AI_SOURCE_CHANGED",
        },
        409,
      );
    }

    if (run.result.kind === "refused") {
      await run.settle(200);
      return json({
        status: "refused",
        drafts: [],
        dropped: 0,
        ...context(household),
      });
    }
    let reply;
    try {
      reply = normalizeSmartAdd(run.result.value, {
        request: input,
        household,
        aliasedText,
      });
    } catch {
      await run.settle(502);
      return json(
        {
          error:
            "Smart Add could not read that. Try different words, or use the buttons below.",
          code: "AI_PROVIDER_BAD_OUTPUT",
        },
        502,
      );
    }
    await run.settle(200);
    return json({ ...reply, ...context(household) });
  } finally {
    await run.settle(500);
  }

  function context(h: typeof household) {
    return {
      // The caller's own household only: who rows can be for, and its lists.
      people: [...h.people.values()],
      lists: h.lists,
      peopleOnEvents: eventPeopleReady(),
    };
  }
}
