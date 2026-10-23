import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import { runOwnedForeground } from "@/lib/owned-request-http";

export type CaptureAvailabilityData = {
  allowed: boolean;
  configured: boolean;
  userId?: string;
  familyId?: string;
  role?: string;
};

export type CaptureAvailabilityCheck =
  | { state: "available"; data: CaptureAvailabilityData }
  | {
      state: "unavailable";
      childBlocked: boolean;
      data?: CaptureAvailabilityData;
    };

/**
 * Read the small authenticated capture gate without importing the capture
 * editor or its review schemas. The launcher uses this before loading the
 * modal-only editor; the editor reuses the same bounded response contract.
 */
export async function readCaptureAvailability(
  signal?: AbortSignal,
): Promise<CaptureAvailabilityCheck> {
  const result = await runOwnedForeground(
    async (requestSignal) => {
      const response = await fetch("/api/capture", {
        cache: "no-store",
        credentials: "same-origin",
        signal: requestSignal,
      });
      if (response.status === 401 || response.status === 403) {
        void response.body?.cancel().catch(() => undefined);
        return { kind: "refused" as const };
      }
      const body = await readBoundedJsonResponse(response, requestSignal, 8192);
      return { kind: "reply" as const, response, body };
    },
    { signal },
  );
  if ("kind" in result && result.kind === "unknown")
    throw new Error("Capture availability unavailable");
  if (result.kind === "refused")
    return { state: "unavailable", childBlocked: false };
  if (!result.response.ok) throw new Error("Capture availability check failed");
  const value: unknown = result.body;
  if (!value || typeof value !== "object")
    throw new Error("Unreadable capture availability");
  const data = value as {
    allowed?: unknown;
    configured?: unknown;
    userId?: unknown;
    familyId?: unknown;
    role?: unknown;
  };
  if (typeof data.allowed !== "boolean" || typeof data.configured !== "boolean")
    throw new Error("Incomplete capture availability");
  const normalized = {
    allowed: data.allowed,
    configured: data.configured,
    ...(typeof data.userId === "string" ? { userId: data.userId } : {}),
    ...(typeof data.familyId === "string" ? { familyId: data.familyId } : {}),
    ...(typeof data.role === "string" ? { role: data.role } : {}),
  } satisfies CaptureAvailabilityData;
  if (!data.allowed)
    return { state: "unavailable", childBlocked: true, data: normalized };
  if (!data.configured)
    return { state: "unavailable", childBlocked: false, data: normalized };
  return { state: "available", data: normalized };
}
