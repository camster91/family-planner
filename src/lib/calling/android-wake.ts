/** Server-only FCM transport. A wake hint never authorizes answering a call. */
import { createPrivateKey, sign } from "node:crypto";
import { z } from "zod";
import {
  abortable,
  readBoundedJsonResponse,
} from "@/lib/bounded-json-response";
import { RING_MS } from "./protocol";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const project = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/);
const credentialsSchema = z.object({
  type: z.literal("service_account"),
  project_id: project,
  private_key_id: z.string().regex(/^[a-f0-9]{40}$/),
  private_key: z.string().min(100).max(16_384),
  client_email: z.string().email().max(254),
  token_uri: z.literal(TOKEN_URL),
});
export const androidWakeHintSchema = z
  .object({
    protocol: z.literal("herewoven.call-wake.v1"),
    callId: z.string().uuid(),
    installationId: z.string().uuid(),
    epoch: z.string().uuid(),
    revision: z.number().int().positive().safe(),
    expiresAt: z.number().int().nonnegative().safe(),
  })
  .strict();
export type AndroidWakeHint = z.infer<typeof androidWakeHintSchema>;
export type AndroidWakeResult = {
  status:
    | "accepted"
    | "unavailable"
    | "expired"
    | "cancelled"
    | "invalid-destination"
    | "rejected"
    | "unknown";
};
export type AndroidWakeConfig = {
  enabled: boolean;
  projectId?: string;
  serviceAccountJson?: string;
};
type Deps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const discard = (response: Response) => {
  void response.body?.cancel().catch(() => undefined);
};

/**
 * One bounded attempt, no background jobs or retries. The call coordinator must
 * recheck live call/installation authority immediately before dispatch via
 * stillCurrent. It must also validate a wake against canonical state on receipt.
 * Provider acceptance is not delivery. Errors never expose provider bodies.
 * Not connected to production until native ownership/call state is implemented.
 */
export async function sendAndroidCallWake(
  config: AndroidWakeConfig,
  destination: string | (() => string | null),
  input: AndroidWakeHint,
  stillCurrent: () => Promise<boolean>,
  deps: Deps = {},
): Promise<AndroidWakeResult> {
  const now = deps.now ?? Date.now;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const hint = androidWakeHintSchema.safeParse(input);
  if (!config.enabled) return { status: "unavailable" };
  if (!hint.success) return { status: "rejected" };
  const remaining = hint.data.expiresAt - now();
  if (remaining <= 0 || remaining > RING_MS) return { status: "expired" };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Math.min(6_000, remaining),
  );
  let dispatched = false;
  try {
    if (!config.serviceAccountJson || config.serviceAccountJson.length > 24_000)
      return { status: "unavailable" };
    const credentials = credentialsSchema.safeParse(
      JSON.parse(config.serviceAccountJson),
    );
    if (
      !credentials.success ||
      !project.safeParse(config.projectId).success ||
      credentials.data.project_id !== config.projectId ||
      !credentials.data.client_email.endsWith(
        `@${config.projectId}.iam.gserviceaccount.com`,
      )
    )
      return { status: "unavailable" };
    if (!(await abortable(stillCurrent(), controller.signal)))
      return { status: "cancelled" };
    const tokenDestination =
      typeof destination === "string" ? destination : destination();
    if (!tokenDestination || !/^[\x21-\x7e]{16,4096}$/.test(tokenDestination))
      return { status: "rejected" };
    const key = createPrivateKey(credentials.data.private_key);
    if (
      key.asymmetricKeyType !== "rsa" ||
      (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
    )
      return { status: "unavailable" };
    const issued = Math.floor(now() / 1000);
    const header = encode({
      alg: "RS256",
      typ: "JWT",
      kid: credentials.data.private_key_id,
    });
    const claims = encode({
      iss: credentials.data.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issued,
      exp: issued + 300,
    });
    const unsigned = `${header}.${claims}`;
    const assertion = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), key).toString("base64url")}`;
    const tokenResponse = await abortable(
      fetchImpl(TOKEN_URL, {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
      }),
      controller.signal,
    );
    if (!tokenResponse.ok) {
      discard(tokenResponse);
      return { status: "unavailable" };
    }
    const token = z
      .object({
        access_token: z
          .string()
          .min(1)
          .max(8192)
          .regex(/^[\x21-\x7e]+$/),
        token_type: z.literal("Bearer"),
        expires_in: z.number().int().positive(),
      })
      .safeParse(
        await readBoundedJsonResponse(tokenResponse, controller.signal, 12_288),
      );
    if (!token.success) return { status: "unavailable" };
    // OAuth may have taken most of the ring window; never send an old hint.
    if (hint.data.expiresAt <= now()) return { status: "expired" };
    if (!(await abortable(stillCurrent(), controller.signal)))
      return { status: "cancelled" };
    if (controller.signal.aborted || hint.data.expiresAt <= now())
      return { status: "expired" };
    dispatched = true;
    const response = await abortable(
      fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
        {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token.data.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: tokenDestination,
              android: {
                priority: "HIGH",
                ttl: "0s",
                restricted_package_name: "com.ashbi.familyplanner",
              },
              data: {
                protocol: hint.data.protocol,
                callId: hint.data.callId,
                installationId: hint.data.installationId,
                epoch: hint.data.epoch,
                revision: String(hint.data.revision),
                expiresAt: String(hint.data.expiresAt),
              },
            },
          }),
        },
      ),
      controller.signal,
    );
    if (response.status >= 500) {
      discard(response);
      return { status: "unknown" };
    }
    if ([401, 403, 429].includes(response.status)) {
      discard(response);
      return { status: "unavailable" };
    }
    const body = await readBoundedJsonResponse(
      response,
      controller.signal,
      8192,
    );
    if (response.ok) {
      const receipt = z.object({ name: z.string().max(1024) }).safeParse(body);
      return {
        status:
          receipt.success &&
          receipt.data.name.startsWith(
            `projects/${config.projectId}/messages/`,
          ) &&
          receipt.data.name.length >
            `projects/${config.projectId}/messages/`.length
            ? "accepted"
            : "unknown",
      };
    }
    const error = z
      .object({
        error: z.object({
          details: z
            .array(
              z.object({
                "@type": z.string(),
                errorCode: z.string().optional(),
              }),
            )
            .optional(),
        }),
      })
      .safeParse(body);
    // INVALID_ARGUMENT can mean a bad payload, not a dead registration. Only
    // an explicit FCM UNREGISTERED verdict is eligible for later CAS revocation.
    const unregistered =
      response.status === 404 &&
      error.success &&
      error.data.error.details?.some(
        (detail) =>
          detail["@type"] ===
            "type.googleapis.com/google.firebase.fcm.v1.FcmError" &&
          detail.errorCode === "UNREGISTERED",
      );
    return { status: unregistered ? "invalid-destination" : "rejected" };
  } catch {
    return { status: dispatched ? "unknown" : "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
