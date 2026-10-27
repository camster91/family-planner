/** Public protocol information is never household authorization or plugin permission. */
import { z } from "zod";
import { runOwnedForeground } from "./owned-request-http";
import { readBoundedJsonResponse } from "./bounded-json-response";

export const capabilityManifestSchema = z
  .object({
    contract: z.literal("herewoven.capabilities.v1"),
    memberProtocols: z.array(z.union([z.literal(1), z.literal(2)])).min(1),
    queueContainerVersion: z.literal(1),
    queueActions: z.array(
      z
        .object({
          action: z.string().min(1).max(80),
          version: z.number().int().positive(),
          namespace: z.enum(["person", "device"]),
        })
        .strict(),
    ),
  })
  .strict();
export type ApiCapabilities = z.infer<typeof capabilityManifestSchema>;

export type ProtocolDecision =
  | { supported: true }
  | {
      supported: false;
      reason:
        | "SERVER_CHECK_REQUIRED"
        | "MEMBER_PROTOCOL_UNAVAILABLE"
        | "QUEUE_PROTOCOL_UNAVAILABLE";
      recovery: "refresh-and-retain-pending";
    };

/** Do not translate a member ID into a User ID or recreate a rejected intent. */
export function checkMemberProtocol(
  manifest: ApiCapabilities | null,
  required: 1 | 2,
): ProtocolDecision {
  if (!manifest)
    return {
      supported: false,
      reason: "SERVER_CHECK_REQUIRED",
      recovery: "refresh-and-retain-pending",
    };
  return manifest.memberProtocols.includes(required)
    ? { supported: true }
    : {
        supported: false,
        reason: "MEMBER_PROTOCOL_UNAVAILABLE",
        recovery: "refresh-and-retain-pending",
      };
}

/** Same opaque key/body must be retained when a server cannot accept an operation. */
export function checkQueuedProtocol(
  manifest: ApiCapabilities | null,
  operation: { action: string; v: number },
  namespace: "person" | "device",
): ProtocolDecision {
  if (!manifest)
    return {
      supported: false,
      reason: "SERVER_CHECK_REQUIRED",
      recovery: "refresh-and-retain-pending",
    };
  return manifest.queueActions.some(
    (a) =>
      a.action === operation.action &&
      a.version === operation.v &&
      a.namespace === namespace,
  )
    ? { supported: true }
    : {
        supported: false,
        reason: "QUEUE_PROTOCOL_UNAVAILABLE",
        recovery: "refresh-and-retain-pending",
      };
}

/** Read only. A failed/old-server response is unknown, never proof of write support. */
export async function readApiCapabilities(
  fetcher: typeof fetch = fetch,
  options: { signal?: AbortSignal; timeoutMs?: number; credentials?: RequestCredentials } = {},
): Promise<ApiCapabilities | null> {
  const result = await runOwnedForeground(async signal => {
    const response = await fetcher("/api/capabilities", {
      credentials: options.credentials ?? "same-origin", cache: "no-store", signal,
    });
    if (!response.ok) return { kind: "reply" as const, manifest: null };
    const body = await readBoundedJsonResponse(response, signal, 32 * 1024);
    const parsed = capabilityManifestSchema.safeParse(body);
    return { kind: "reply" as const, manifest: parsed.success ? parsed.data : null };
  }, { signal: options.signal, timeoutMs: options.timeoutMs ?? 3000 });
  return result.kind === "reply" ? result.manifest : null;
}
