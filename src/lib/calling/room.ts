import {
  CALL_PROTOCOL,
  HEARTBEAT_MS,
  MAX_CALL_MS,
  MAX_FRAME_BYTES,
  RING_MS,
  clientMessageSchema,
  type CallEndpoint,
  type ServerCallMessage,
} from "./protocol";
import { callActorAllowed } from "./authority";
import { verifyCallGrant, type CallGrant } from "./grant";
import {
  DEVICE_ACCESS_COOKIE,
  PERSON_SESSION_COOKIE,
} from "@/lib/device-cookies";
import type { CallingEnv } from "./server";
export interface CallSocket extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}
export interface CallRoomContext {
  acceptWebSocket(socket: WebSocket): void;
  getWebSockets(): CallSocket[];
}
type Attachment = {
  version: 1;
  grant: CallGrant;
  joined: number;
  seen: number;
  dnd: boolean;
  rate: { start: number; count: number };
  call?: {
    id: string;
    peer: string;
    phase: "outgoing" | "incoming" | "active";
    initiator: boolean;
    mode: "voice" | "video";
    expires: number;
  };
};
/** No media/signaling bodies in durable storage or attachments. */
export class FamilyCallRoomCore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private ctx: CallRoomContext,
    private env: CallingEnv,
  ) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const job = this.queue.then(work);
    this.queue = job.catch(() => undefined);
    return job;
  }
  private data(socket: CallSocket): Attachment {
    const data = socket.deserializeAttachment() as Attachment;
    if (data?.version !== 1) throw Error("Unsupported calling connection");
    return data;
  }
  private put(socket: CallSocket, data: Attachment) {
    socket.serializeAttachment(data);
  }
  private send(socket: CallSocket, message: ServerCallMessage) {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      /* disconnected socket; close/heartbeat clears its peer */
    }
  }
  private sockets() {
    return this.ctx.getWebSockets().filter((s) => s.readyState === 1);
  }
  private endpoint(socket: CallSocket): CallEndpoint {
    const a = this.data(socket);
    return {
      id: a.grant.endpointId,
      label: a.grant.label,
      kind: a.grant.kind,
      status: a.call ? "busy" : a.dnd ? "dnd" : "available",
    };
  }
  private find(id: string) {
    return this.sockets().find((s) => this.data(s).grant.endpointId === id);
  }
  private async presence() {
    for (const socket of this.sockets())
      if (!(await this.allowed(socket))) {
        this.end(socket, "unavailable");
        socket.close(4003, "Calling unavailable");
      }
    for (const socket of this.sockets())
      this.send(socket, {
        type: "presence",
        endpoints: this.sockets()
          .filter((s) => s !== socket)
          .map((s) => this.endpoint(s)),
      });
  }
  private async allowed(socket: CallSocket) {
    const a = this.data(socket);
    return (
      this.env.CALLING_ENABLED === "1" &&
      !!this.env.DB &&
      Date.now() - a.joined < 8 * 60 * 60_000 &&
      (a.grant.kind !== "device" ||
        ["1", "true"].includes(this.env.SHARED_DEVICE_ENABLED || "")) &&
      (await callActorAllowed(this.env.DB, a.grant))
    );
  }
  private end(socket: CallSocket, reason: "ended" | "unavailable" | "timeout") {
    const a = this.data(socket),
      call = a.call;
    if (!call) return;
    delete a.call;
    this.put(socket, a);
    this.send(socket, { type: "ended", callId: call.id, reason });
    const peer = this.find(call.peer);
    if (!peer) return;
    const b = this.data(peer);
    if (b.call?.id === call.id && b.call.peer === a.grant.endpointId) {
      delete b.call;
      this.put(peer, b);
      this.send(peer, { type: "ended", callId: call.id, reason });
    }
  }
  private reap() {
    const now = Date.now();
    for (const socket of this.sockets()) {
      const a = this.data(socket);
      if (now - a.seen > HEARTBEAT_MS * 3) {
        this.end(socket, "unavailable");
        socket.close(4001, "Connection expired");
      } else if (a.call && a.call.expires <= now) this.end(socket, "timeout");
    }
  }
  fetch(request: Request): Promise<Response> {
    return this.serial(async () => {
      if (
        this.env.CALLING_ENABLED !== "1" ||
        !this.env.DB ||
        !this.env.JWT_SECRET ||
        request.headers.get("upgrade")?.toLowerCase() !== "websocket"
      )
        return new Response(null, { status: 404 });
      const origin = request.headers.get("origin") || "",
        protocols =
          request.headers
            .get("sec-websocket-protocol")
            ?.split(",")
            .map((s) => s.trim()) || [];
      if (
        origin !== new URL(request.url).origin ||
        origin !==
          new URL(this.env.NEXT_PUBLIC_APP_URL || "https://herewoven.com")
            .origin ||
        protocols.length !== 2 ||
        protocols[0] !== CALL_PROTOCOL
      )
        return new Response(null, { status: 403 });
      const cookies = new Map(
        (request.headers.get("cookie") || "").split(";").map((c) => {
          const i = c.indexOf("=");
          return [c.slice(0, i).trim(), c.slice(i + 1)];
        }),
      );
      const grant = [PERSON_SESSION_COOKIE, DEVICE_ACCESS_COOKIE]
        .map((name) =>
          verifyCallGrant(
            protocols[1],
            this.env.JWT_SECRET!,
            origin,
            cookies.get(name) || "",
          ),
        )
        .find(Boolean);
      if (
        !grant ||
        (grant.kind === "person" && cookies.has(DEVICE_ACCESS_COOKIE)) ||
        (grant.kind === "device" &&
          !["1", "true"].includes(this.env.SHARED_DEVICE_ENABLED || "")) ||
        !(await callActorAllowed(this.env.DB, grant))
      )
        return new Response(null, { status: 403 });
      this.reap();
      if (
        this.sockets().length >= 24 ||
        this.sockets().some(
          (s) =>
            this.data(s).grant.endpointId === grant.endpointId ||
            this.data(s).grant.familyId !== grant.familyId,
        )
      )
        return new Response(null, { status: 409 });
      const Pair = (
        globalThis as unknown as {
          WebSocketPair: new () => { 0: WebSocket; 1: CallSocket };
        }
      ).WebSocketPair;
      const pair = new Pair(),
        now = Date.now();
      this.ctx.acceptWebSocket(pair[1]);
      this.put(pair[1], {
        version: 1,
        grant,
        joined: now,
        seen: now,
        dnd: false,
        rate: { start: now, count: 0 },
      });
      this.send(pair[1], {
        type: "ready",
        endpointId: grant.endpointId,
        endpoints: this.sockets()
          .filter((s) => s !== pair[1])
          .map((s) => this.endpoint(s)),
      });
      await this.presence();
      return new Response(null, {
        status: 101,
        headers: { "Sec-WebSocket-Protocol": CALL_PROTOCOL },
        webSocket: pair[0],
      } as ResponseInit & { webSocket: WebSocket });
    });
  }
  webSocketMessage(
    socket: CallSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    return this.serial(async () => {
      try {
        if (
          typeof raw !== "string" ||
          new TextEncoder().encode(raw).byteLength > MAX_FRAME_BYTES
        ) {
          socket.close(1009, "Message too large");
          return;
        }
        if (!(await this.allowed(socket))) {
          this.end(socket, "unavailable");
          socket.close(4003, "Calling unavailable");
          await this.presence();
          return;
        }
        let a = this.data(socket);
        const now = Date.now();
        if (now - a.rate.start >= 60_000) a.rate = { start: now, count: 0 };
        a.seen = now;
        a.rate.count++;
        this.put(socket, a);
        if (a.rate.count > 120) {
          this.end(socket, "unavailable");
          socket.close(4008, "Message limit");
          return;
        }
        this.reap();
        a = this.data(socket);
        const parsed = clientMessageSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
          this.send(socket, { type: "error", code: "invalid" });
          return;
        }
        const m = parsed.data;
        if (m.type === "heartbeat") {
          this.send(socket, {
            type: "presence",
            endpoints: this.sockets()
              .filter((s) => s !== socket)
              .map((s) => this.endpoint(s)),
          });
          return;
        }
        if (m.type === "availability") {
          a.dnd = m.dnd;
          this.put(socket, a);
          await this.presence();
          return;
        }
        if (m.type === "call") {
          const peer = this.find(m.target);
          if (
            !peer ||
            peer === socket ||
            a.dnd ||
            !(await this.allowed(peer))
          ) {
            this.send(socket, { type: "error", code: "unavailable" });
            return;
          }
          const b = this.data(peer);
          if (a.call || b.call || b.dnd) {
            this.send(socket, { type: "error", code: "busy" });
            return;
          }
          const id = crypto.randomUUID(),
            expires = now + RING_MS;
          a.call = {
            id,
            peer: b.grant.endpointId,
            phase: "outgoing",
            initiator: true,
            mode: m.mode,
            expires,
          };
          b.call = {
            id,
            peer: a.grant.endpointId,
            phase: "incoming",
            initiator: false,
            mode: m.mode,
            expires,
          };
          this.put(socket, a);
          this.put(peer, b);
          this.send(socket, {
            type: "ringing",
            callId: id,
            peer: this.endpoint(peer),
            incoming: false,
            mode: m.mode,
          });
          this.send(peer, {
            type: "ringing",
            callId: id,
            peer: this.endpoint(socket),
            incoming: true,
            mode: m.mode,
          });
          await this.presence();
          return;
        }
        // Re-read after reap: an expired call must never be resurrected.
        const current = this.data(socket),
          call = current.call;
        if (!call || call.id !== m.callId) {
          this.send(socket, { type: "error", code: "invalid" });
          return;
        }
        const peer = this.find(call.peer);
        if (!peer || !(await this.allowed(peer))) {
          this.end(socket, "unavailable");
          await this.presence();
          return;
        }
        const b = this.data(peer);
        if (
          b.call?.id !== call.id ||
          b.call.peer !== current.grant.endpointId
        ) {
          this.end(socket, "unavailable");
          await this.presence();
          return;
        }
        if (m.type === "end") {
          this.end(socket, "ended");
          await this.presence();
          return;
        }
        if (m.type === "accept") {
          if (
            (m.mode === "video" && call.mode !== "video") ||
            call.phase !== "incoming" ||
            b.call.phase !== "outgoing" ||
            call.expires <= now
          ) {
            this.send(socket, { type: "error", code: "invalid" });
            return;
          }
          call.mode = m.mode;
          b.call.mode = m.mode;
          call.phase = "active";
          call.expires = now + MAX_CALL_MS;
          b.call.phase = "active";
          b.call.expires = call.expires;
          this.put(socket, current);
          this.put(peer, b);
          this.send(socket, {
            type: "accepted",
            callId: call.id,
            initiator: false,
            mode: m.mode,
          });
          this.send(peer, {
            type: "accepted",
            callId: call.id,
            initiator: true,
            mode: m.mode,
          });
          return;
        }
        if (
          m.type === "signal" &&
          m.signal.type !== "ice" &&
          (/^m=application\s/m.test(m.signal.sdp) ||
            (call.mode === "voice" && /^m=video\s/m.test(m.signal.sdp)))
        ) {
          this.send(socket, { type: "error", code: "invalid" });
          return;
        }
        if (
          m.type === "signal" &&
          call.phase === "active" &&
          (m.signal.type === "ice" ||
            (m.signal.type === "offer" ? call.initiator : !call.initiator))
        )
          this.send(peer, {
            type: "signal",
            callId: call.id,
            signal: m.signal,
          });
        else this.send(socket, { type: "error", code: "invalid" });
      } catch {
        this.end(socket, "unavailable");
        socket.close(1011, "Calling unavailable");
      }
    });
  }
  webSocketClose(socket: CallSocket): Promise<void> {
    return this.serial(async () => {
      try {
        this.end(socket, "unavailable");
        await this.presence();
      } catch {
        /* stale attachment is discarded */
      }
    });
  }
}
