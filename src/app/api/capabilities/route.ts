import { NextRequest, NextResponse } from "next/server";
import { QUEUEABLE_ACTIONS, QUEUE_SCHEMA_VERSION } from "@/lib/offline-queue";
import { withRouteTelemetry } from "@/lib/route-telemetry";
import type { ApiCapabilities } from "@/lib/api-capabilities";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Static public implementation contract; no account, device, household or env metadata. */
async function getCapabilities(_request: NextRequest) {
  const manifest: ApiCapabilities = {
    contract: "herewoven.capabilities.v1",
    // Dormant profiles are not a supported assignment/read protocol yet.
    memberProtocols: [1],
    queueContainerVersion: QUEUE_SCHEMA_VERSION,
    queueActions: Object.entries(QUEUEABLE_ACTIONS).map(([action, spec]) => ({
      action,
      version: spec.version,
      namespace: spec.namespace,
    })),
  };
  return NextResponse.json(manifest, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export const GET = withRouteTelemetry("/api/capabilities", getCapabilities);
