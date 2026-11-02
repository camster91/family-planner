/** Local-only coordinator diagnostic. The ownership proof is FABRICATED here. */
import { DurableObject } from "cloudflare:workers";
import {
  FamilyCallRoomCore,
  type CallSocket,
  type CallRoomContext,
} from "../../../src/lib/calling/room";
import { callCookieHash, signCallGrant } from "../../../src/lib/calling/grant";
import { forwardCallingSocket } from "../../../src/lib/calling/ingress";
import type { CallingEnv } from "../../../src/lib/calling/server";
import type { NativeCallBinding } from "../../../src/lib/calling/native-binding";
type Env = CallingEnv & { LOCAL_SLEEPING_CALL_FIXTURE?: string };
export class SleepingCallFixture extends DurableObject<Env> {
  private room: FamilyCallRoomCore;
  constructor(
    private fixtureCtx: CallRoomContext,
    private fixtureEnv: Env,
  ) {
    super(fixtureCtx, fixtureEnv);
    this.room = new FamilyCallRoomCore(fixtureCtx, fixtureEnv);
  }
  async fetch(request: Request) {
    if (this.fixtureEnv.LOCAL_SLEEPING_CALL_FIXTURE !== "1")
      return new Response(null, { status: 404 });
    if (new URL(request.url).pathname === "/api/calls/socket")
      return this.room.fetch(request);
    const body = (await request.json()) as {
      op: string;
      endpointId: string;
      callId: string;
      target: NativeCallBinding;
      proof?: string;
    };
    const socket = this.fixtureCtx.getWebSockets().find(
      (s) =>
        (
          (s as CallSocket).deserializeAttachment() as {
            grant?: { endpointId?: string };
          }
        )?.grant?.endpointId === body.endpointId,
    ) as CallSocket | undefined;
    if (body.op === "reconstruct") {
      this.room = new FamilyCallRoomCore(this.fixtureCtx, this.fixtureEnv);
      return Response.json(true);
    }
    if (!socket) return Response.json(false);
    if (body.op === "begin")
      return Response.json(
        await this.room.beginSleepingCall(socket, body.target, "voice"),
      );
    if (body.op === "reserve")
      return Response.json(
        await this.room.reserveSleepingWake(socket, body.callId),
      );
    if (body.op === "current")
      return Response.json(
        await this.room.sleepingCallCurrent(socket, body.callId),
      );
    if (body.op === "claim")
      return Response.json(
        await this.room.claimSleepingCall(
          socket,
          body.callId,
          body.target,
          "voice",
          async () => body.proof === "fabricated-local-proof",
        ),
      );
    return new Response(null, { status: 404 });
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
const fixture = {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      env.LOCAL_SLEEPING_CALL_FIXTURE !== "1" ||
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      return new Response(null, { status: 404 });
    if (url.pathname === "/api/calls/socket")
      return forwardCallingSocket(request, env);
    if (url.pathname === "/session") {
      const userId = url.searchParams.get("person");
      if (!["a", "b", "c"].includes(userId || ""))
        return new Response(null, { status: 400 });
      const now = Date.now(),
        endpointId = crypto.randomUUID();
      return Response.json({
        endpointId,
        grant: signCallGrant(
          {
            purpose: "family-call-v1",
            kind: "person",
            userId: userId!,
            familyId: "sleeping-fixture-family",
            generation: 0,
            label: "Fabricated phone",
            endpointId,
            origin: url.origin,
            cookieHash: callCookieHash(`fabricated-session-${userId}`),
            issuedAt: now,
            expiresAt: now + 60_000,
          },
          env.JWT_SECRET!,
        ),
      });
    }
    if (url.pathname === "/control") {
      const id = env.FAMILY_CALLS!.idFromName(
        "family-calls-v1:sleeping-fixture-family",
      );
      return env.FAMILY_CALLS!.get(id).fetch(request);
    }
    return new Response(null, { status: 404 });
  },
};

export default fixture;
