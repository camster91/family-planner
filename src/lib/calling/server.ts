import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { z } from "zod";
import { authenticateWithFamily } from "@/lib/api-auth";
import { authenticateDevice } from "@/lib/device-route";
import { killSwitch } from "@/lib/device-http";
import {
  DEVICE_ACCESS_COOKIE,
  PERSON_SESSION_COOKIE,
} from "@/lib/device-cookies";
import { validateCsrf } from "@/lib/csrf";
import { checkRateLimit } from "@/lib/rate-limit-db";
import { readBoundedJsonResponse } from "@/lib/bounded-json-response";
import {
  boundedRequestText,
  RequestBodyTooLarge,
} from "@/lib/bounded-request-text";
import type { D1Store } from "@/lib/cloudflare/database";
import type { CallActor } from "./protocol";
import { callActorAllowed } from "./authority";
import { callCookieHash, signCallGrant } from "./grant";
export type CallingEnv = {
  CALLING_ENABLED?: string;
  JWT_SECRET?: string;
  CALLING_TURN_KEY_ID?: string;
  CALLING_TURN_API_TOKEN?: string;
  NEXT_PUBLIC_APP_URL?: string;
  SHARED_DEVICE_ENABLED?: string;
  DB?: D1Store;
  FAMILY_CALLS?: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
};
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const labelSchema = z
  .object({ label: z.string().trim().min(1).max(40) })
  .strict();
export async function createCallingSession(
  request: NextRequest,
  device = false,
) {
  if (process.env.CALLING_ENABLED !== "1") return json({ enabled: false }, 404);
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;
  try {
    const env = getCloudflareContext().env as unknown as CallingEnv;
    if (
      !env.DB ||
      !env.FAMILY_CALLS ||
      !env.JWT_SECRET ||
      env.CALLING_ENABLED !== "1" ||
      !env.CALLING_TURN_KEY_ID ||
      !env.CALLING_TURN_API_TOKEN
    )
      return json({ error: "CALLING_UNAVAILABLE" }, 503);
    const expectedOrigin = new URL(
      env.NEXT_PUBLIC_APP_URL || "https://herewoven.com",
    ).origin;
    if (request.headers.get("origin") !== expectedOrigin)
      return json({ error: "CALLING_ORIGIN" }, 403);
    let actor: CallActor, cookie: string;
    if (device) {
      const off = killSwitch();
      if (off) return off;
      const auth = await authenticateDevice(request);
      if (!auth.ok) return auth.response;
      actor = {
        kind: "device",
        deviceId: auth.actor.deviceId,
        sessionId: auth.actor.sessionId,
        familyId: auth.actor.familyId,
        label: auth.device.label.slice(0, 60),
      };
      cookie = request.cookies.get(DEVICE_ACCESS_COOKIE)?.value || "";
    } else {
      const [auth, error] = await authenticateWithFamily(request);
      if (error) return error;
      let body: unknown;
      try {
        body = JSON.parse(await boundedRequestText(request, 2048));
      } catch (error) {
        return json(
          {
            error:
              error instanceof RequestBodyTooLarge
                ? "CALLING_BODY_TOO_LARGE"
                : "CALLING_LABEL",
          },
          error instanceof RequestBodyTooLarge ? 413 : 400,
        );
      }
      const input = labelSchema.safeParse(body);
      if (!input.success) return json({ error: "CALLING_LABEL" }, 400);
      actor = {
        kind: "person",
        userId: auth.user.id,
        familyId: auth.user.family_id,
        generation: auth.payload.tv ?? 0,
        label: `${auth.user.name.slice(0, 28)} · ${input.data.label}`.slice(
          0,
          60,
        ),
      };
      cookie = request.cookies.get(PERSON_SESSION_COOKIE)?.value || "";
    }
    if (!cookie || !(await callActorAllowed(env.DB, actor)))
      return json({ error: "CALLING_NOT_ENABLED" }, 403);
    const rate = await checkRateLimit(
      `calling-session:${actor.kind}:${actor.kind === "person" ? actor.userId : actor.deviceId}`,
      6,
      60_000,
    );
    if (!rate.allowed) return json({ error: "CALLING_RATE_LIMIT" }, 429);
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8_000);
    let raw: unknown;
    try {
      const reply = await fetch(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.CALLING_TURN_KEY_ID)}/credentials/generate-ice-servers`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.CALLING_TURN_API_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ttl: 3600 }),
          signal: controller.signal,
          cache: "no-store",
        },
      );
      if (!reply.ok) return json({ error: "CALLING_UNAVAILABLE" }, 503);
      raw = await readBoundedJsonResponse(reply, controller.signal, 32_768);
    } finally {
      clearTimeout(timer);
    }
    const parsed = z
      .object({
        iceServers: z
          .array(
            z.object({
              urls: z.array(z.string().regex(/^(stun|turn|turns):/)).max(12),
              username: z.string().max(1024).optional(),
              credential: z.string().max(1024).optional(),
            }),
          )
          .min(1)
          .max(4),
      })
      .safeParse(raw);
    if (
      !parsed.success ||
      !parsed.data.iceServers.some(
        (s) =>
          s.urls.some((u) => /^turns?:/.test(u)) && s.username && s.credential,
      )
    )
      return json({ error: "CALLING_UNAVAILABLE" }, 503);
    // Authority may have changed during provider access. Do not grant stale access.
    if (!(await callActorAllowed(env.DB, actor)))
      return json({ error: "CALLING_NOT_ENABLED" }, 403);
    const now = Date.now();
    return json({
      enabled: true,
      socketPath: "/api/calls/socket",
      grant: signCallGrant(
        {
          ...actor,
          endpointId: randomUUID(),
          origin: expectedOrigin,
          cookieHash: callCookieHash(cookie),
          purpose: "family-call-v1",
          issuedAt: now,
          expiresAt: now + 60_000,
        },
        env.JWT_SECRET,
      ),
      iceServers: parsed.data.iceServers,
    });
  } catch {
    return json({ error: "CALLING_UNAVAILABLE" }, 503);
  }
}
