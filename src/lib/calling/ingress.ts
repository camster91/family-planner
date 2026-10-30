import {
  DEVICE_ACCESS_COOKIE,
  PERSON_SESSION_COOKIE,
} from "@/lib/device-cookies";
import { CALL_PROTOCOL } from "./protocol";
import { verifyCallGrant } from "./grant";
import type { CallingEnv } from "./server";
const denied = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });
/** Socket upgrades bypass the compute pool, but never the grant/cookie/origin checks. */
export async function forwardCallingSocket(
  request: Request,
  env: CallingEnv,
): Promise<Response> {
  if (env.CALLING_ENABLED !== "1" || !env.FAMILY_CALLS || !env.JWT_SECRET)
    return denied(404);
  if (
    request.method !== "GET" ||
    request.headers.get("upgrade")?.toLowerCase() !== "websocket"
  )
    return denied(426);
  const origin = request.headers.get("origin");
  if (
    !origin ||
    origin !== new URL(request.url).origin ||
    origin !==
      new URL(env.NEXT_PUBLIC_APP_URL || "https://herewoven.com").origin
  )
    return denied(403);
  const protocols =
    request.headers
      .get("sec-websocket-protocol")
      ?.split(",")
      .map((s) => s.trim()) || [];
  if (protocols.length !== 2 || protocols[0] !== CALL_PROTOCOL)
    return denied(403);
  const cookieText = request.headers.get("cookie") || "";
  const cookies = new Map(
    cookieText.split(";").map((c) => {
      const split = c.indexOf("=");
      return [c.slice(0, split).trim(), c.slice(split + 1)];
    }),
  );
  // The cookie kind is untrusted until the signed grant verifies. Try both;
  // only the original exact cookie hash can match the signed payload.
  const grant = [PERSON_SESSION_COOKIE, DEVICE_ACCESS_COOKIE]
    .map((name) =>
      verifyCallGrant(
        protocols[1],
        env.JWT_SECRET!,
        origin,
        cookies.get(name) || "",
      ),
    )
    .find(Boolean);
  if (!grant || (grant.kind === "person" && cookies.has(DEVICE_ACCESS_COOKIE)))
    return denied(403);
  const id = env.FAMILY_CALLS.idFromName("family-calls-v1:" + grant.familyId);
  return env.FAMILY_CALLS.get(id).fetch(request);
}
