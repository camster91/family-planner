import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authenticateWithFamily, requireParent } from "@/lib/api-auth";
import { storageBackend } from "@/lib/storage-backend";
import { getD1Database } from "@/lib/cloudflare/database";
import { prisma } from "@/lib/prisma";
import { readBoundedJson } from "@/lib/bounded-body";
import { claudeAiDeploymentReady } from "@/lib/ai/flags";
import {
  HouseholdAiSettingError,
  readHouseholdAiSetting,
  readManagedAiMonthSpend,
  writeHouseholdAiSetting,
} from "@/lib/ai/household-setting";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const body = z
  .object({
    enabled: z.boolean(),
    expectedRevision: z.number().int().min(0).max(2147483647),
  })
  .strict();

function db() {
  return storageBackend() === "d1" ? getD1Database() : Promise.resolve(prisma!);
}

async function view(familyId: string) {
  const store = await db();
  const [setting, spent] = await Promise.all([
    readHouseholdAiSetting(store, familyId),
    readManagedAiMonthSpend(store, familyId),
  ]);
  return {
    // Whether this app has smart helpers at all. When false the switch is hidden.
    deploymentReady: claudeAiDeploymentReady(),
    enabled: setting.enabled,
    revision: setting.revision,
    monthlyCapMicrousd: setting.monthlyCapMicrousd,
    spentThisMonthMicrousd: spent,
  };
}

/** GET /api/family/smart-helpers — parent-only household AI switch and cap. */
export async function GET(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  const parentError = requireParent(auth.user.role);
  if (parentError) return parentError;
  return NextResponse.json(await view(auth.user.family_id), { headers });
}

/** PUT /api/family/smart-helpers — a parent turns smart helpers on or off. */
export async function PUT(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request);
  if (error) return error;
  const parentError = requireParent(auth.user.role);
  if (parentError) return parentError;
  let raw: unknown;
  try {
    raw = await readBoundedJson(request, 1024);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400, headers },
    );
  }
  const parsed = body.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Send enabled and expectedRevision only." },
      { status: 400, headers },
    );
  // Turning it on needs a deployment that can run it; turning it off is always allowed.
  if (parsed.data.enabled && !claudeAiDeploymentReady())
    return NextResponse.json(
      {
        error: "Smart helpers are not available in this app yet.",
        code: "AI_OFF",
      },
      { status: 409, headers },
    );
  try {
    await writeHouseholdAiSetting(
      await db(),
      {
        userId: auth.user.id,
        familyId: auth.user.family_id,
        generation: auth.payload?.tv ?? 0,
      },
      parsed.data.enabled,
      parsed.data.expectedRevision,
    );
  } catch (e) {
    if (e instanceof HouseholdAiSettingError)
      return NextResponse.json(
        {
          error:
            e.code === "AI_SETTING_CONFLICT"
              ? "This setting changed on another device. Refresh and try again."
              : e.code === "AI_SETTING_FORBIDDEN"
                ? "Only parents can change this."
                : "This setting could not be saved. Try again later.",
          code: e.code,
        },
        { status: e.status, headers },
      );
    throw e;
  }
  return NextResponse.json(await view(auth.user.family_id), { headers });
}
