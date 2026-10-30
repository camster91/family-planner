import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { authenticateWithFamily } from "@/lib/api-auth";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit-db";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import { callActorAllowed } from "./authority";
import type { CallingEnv } from "./server";
import {
  NATIVE_CALL_REGISTRATION_PROTOCOL,
  nativeRegistrationSchema,
  nativeUnregisterSchema,
  sameNativeOwner,
} from "./native-registration-contract";
import {
  assertNativeCommand,
  listNativeInstallations,
  inspectNativeInstallation,
  registerNativeInstallation,
  unregisterNativeInstallation,
  NativeInstallationError,
} from "./native-installations";
import { nativeTokenKeyReady } from "./native-token";

type NativeRegistrationEnv = CallingEnv & {
  CALLING_NATIVE_REGISTRATION_ENABLED?: string;
  NATIVE_CALL_TOKEN_KEY?: string;
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function nativeRegistrationHttp(request: NextRequest) {
  // Registration is a separate, default-off preparation capability. It does
  // not advertise PushKit/FCM/native media support or send a notification.
  if (
    process.env.CALLING_ENABLED !== "1" ||
    process.env.CALLING_NATIVE_REGISTRATION_ENABLED !== "1"
  )
    return json({ error: "NATIVE_CALL_REGISTRATION_DISABLED" }, 404);
  if (request.method !== "GET") {
    const csrf = validateCsrf(request);
    if (csrf) return csrf;
  }
  try {
    const [auth, error] = await authenticateWithFamily(request);
    if (error) return error;
    const env = getCloudflareContext().env as NativeRegistrationEnv;
    if (
      !env.DB ||
      env.CALLING_ENABLED !== "1" ||
      env.CALLING_NATIVE_REGISTRATION_ENABLED !== "1"
    )
      return json({ error: "NATIVE_CALL_UNAVAILABLE" }, 503);
    const owner = {
      userId: auth.user.id,
      familyId: auth.user.family_id,
      generation: auth.payload.tv ?? 0,
    };
    const actor = { kind: "person" as const, ...owner, label: "" };
    if (!(await callActorAllowed(env.DB, actor)))
      return json({ error: "NATIVE_CALL_NOT_ALLOWED" }, 403);
    const now = Date.now();
    if (
      request.method === "GET" &&
      request.nextUrl.searchParams.has("installationId")
    ) {
      const id = request.nextUrl.searchParams.get("installationId")!;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        )
      )
        return json({ error: "NATIVE_CALL_INVALID_BODY" }, 400);
      return json({
        protocol: NATIVE_CALL_REGISTRATION_PROTOCOL,
        owner,
        serverTime: now,
        backgroundRinging: false,
        installation: await inspectNativeInstallation(env.DB, owner, id, now),
      });
    }
    if (request.method === "GET")
      return json({
        protocol: NATIVE_CALL_REGISTRATION_PROTOCOL,
        owner,
        serverTime: now,
        backgroundRinging: false,
        installations: await listNativeInstallations(env.DB, owner, now),
      });
    if (
      request.headers.get("origin") !==
      new URL(env.NEXT_PUBLIC_APP_URL || "https://herewoven.com").origin
    )
      return json({ error: "NATIVE_CALL_ORIGIN" }, 403);
    const rate = await checkRateLimit(
      `native-call-registration:${owner.userId}`,
      12,
      60_000,
    );
    if (!rate.allowed) return json({ error: "NATIVE_CALL_RATE_LIMIT" }, 429);
    let raw: unknown;
    try {
      raw = JSON.parse(await boundedRequestText(request, 8192));
    } catch (error) {
      return json(
        { error: "NATIVE_CALL_INVALID_BODY" },
        error instanceof RequestBodyTooLarge ? 413 : 400,
      );
    }
    if (request.method === "PUT") {
      const parsed = nativeRegistrationSchema.safeParse(raw);
      if (!parsed.success)
        return json({ error: "NATIVE_CALL_INVALID_BODY" }, 400);
      if (!nativeTokenKeyReady(env.NATIVE_CALL_TOKEN_KEY))
        return json({ error: "NATIVE_CALL_KEY_UNAVAILABLE" }, 503);
      const installation = await registerNativeInstallation(
        env.DB,
        owner,
        parsed.data,
        env.NATIVE_CALL_TOKEN_KEY!,
        now,
      );
      return json({
        protocol: NATIVE_CALL_REGISTRATION_PROTOCOL,
        installation,
      });
    }
    if (request.method === "DELETE") {
      const parsed = nativeUnregisterSchema.safeParse(raw);
      if (!parsed.success)
        return json({ error: "NATIVE_CALL_INVALID_BODY" }, 400);
      if (!sameNativeOwner(owner, parsed.data.owner))
        throw new NativeInstallationError("NATIVE_CALL_OWNER_CHANGED", 409);
      assertNativeCommand(parsed.data.issuedAt, now);
      const installation = await unregisterNativeInstallation(
        env.DB,
        owner,
        parsed.data.installationId,
        parsed.data.expected,
      );
      return json({ removed: true, installation });
    }
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  } catch (error) {
    if (error instanceof NativeInstallationError)
      return json({ error: error.code }, error.status);
    return json({ error: "NATIVE_CALL_UNAVAILABLE" }, 503);
  }
}
