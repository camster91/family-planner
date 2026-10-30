/** Local-only media diagnostic. Never the production Worker entrypoint.
 * Bootstrap bypasses login/TURN; canonical D1 call authority and the actual
 * room, ingress and browser controller are exercised without a provider. */
import { DurableObject } from "cloudflare:workers";
import {
  FamilyCallRoomCore,
  type CallRoomContext,
  type CallSocket,
} from "../../../src/lib/calling/room";
import { forwardCallingSocket } from "../../../src/lib/calling/ingress";
import { callCookieHash, signCallGrant } from "../../../src/lib/calling/grant";
import type { CallingEnv } from "../../../src/lib/calling/server";
interface Env extends CallingEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  LOCAL_CALLING_FIXTURE?: string;
}
export class FamilyCallRoom extends DurableObject<Env> {
  private room: FamilyCallRoomCore;
  constructor(ctx: CallRoomContext, env: Env) {
    super(ctx, env);
    this.room = new FamilyCallRoomCore(ctx, env);
  }
  fetch(request: Request) {
    return this.room.fetch(request);
  }
  webSocketMessage(socket: CallSocket, message: string | ArrayBuffer) {
    return this.room.webSocketMessage(socket, message);
  }
  webSocketClose(socket: CallSocket) {
    return this.room.webSocketClose(socket);
  }
  webSocketError(socket: CallSocket) {
    return this.room.webSocketClose(socket);
  }
}
const people: Record<string, { family: string; label: string }> = {
  a: { family: "fixture-family-a", label: "Parent phone" },
  b: { family: "fixture-family-a", label: "Kitchen tablet" },
  c: { family: "fixture-family-b", label: "Other household" },
};
export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      env.LOCAL_CALLING_FIXTURE !== "1" ||
      !["127.0.0.1", "localhost"].includes(url.hostname)
    )
      return new Response(null, { status: 404 });
    if (url.pathname === "/api/calls/socket")
      return forwardCallingSocket(request, env);
    if (url.pathname === "/__fixture/bootstrap" && request.method === "POST") {
      const person = url.searchParams.get("person") || "",
        identity = people[person];
      if (!identity) return new Response(null, { status: 400 });
      return Response.json(
        { person, label: identity.label },
        {
          headers: {
            "Set-Cookie": `session_token=fixture-person-${person}; HttpOnly; SameSite=Strict; Path=/`,
          },
        },
      );
    }
    const person = request.headers
      .get("cookie")
      ?.match(/(?:^|;\s*)session_token=fixture-person-([abc])(?:;|$)/)?.[1];
    if (url.pathname === "/__fixture/session" && request.method === "POST") {
      if (!person) return new Response(null, { status: 401 });
      const now = Date.now(),
        identity = people[person];
      return Response.json({
        enabled: true,
        socketPath: "/api/calls/socket",
        grant: signCallGrant(
          {
            purpose: "family-call-v1",
            kind: "person",
            userId: person,
            familyId: identity.family,
            generation: 0,
            label: identity.label,
            endpointId: crypto.randomUUID(),
            origin: url.origin,
            cookieHash: callCookieHash("fixture-person-" + person),
            issuedAt: now,
            expiresAt: now + 60000,
          },
          env.JWT_SECRET!,
        ),
        iceServers: [],
      });
    }
    if (
      url.pathname === "/__fixture/revoke" &&
      request.method === "POST" &&
      person
    ) {
      await env
        .DB!.prepare(
          'UPDATE "User" SET token_version=token_version+1 WHERE id=?1',
        )
        .bind(person)
        .run();
      return Response.json({ revoked: true });
    }
    return env.ASSETS.fetch(request);
  },
};
