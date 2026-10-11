/** Public protocol information is never household authorization or plugin permission. */
import { z } from "zod";

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
): Promise<ApiCapabilities | null> {
  try {
    const response = await fetcher("/api/capabilities", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return null;
    const result = capabilityManifestSchema.safeParse(await response.json());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
