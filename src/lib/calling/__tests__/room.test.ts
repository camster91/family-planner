import { FamilyCallRoomCore, type CallSocket } from "../room";
import { signCallGrant, callCookieHash, type CallGrant } from "../grant";
import { callActorAllowed } from "../authority";
jest.mock("../authority", () => ({
  callActorAllowed: jest.fn(async () => true),
}));
const secret = "fabricated-calling-test-secret-at-least-32-characters",
  origin = "https://herewoven.example.test";
class Socket {
  readyState = 1;
  data: unknown;
  messages: any[] = [];
  closeCode?: number;
  serializeAttachment(value: unknown) {
    this.data = structuredClone(value);
  }
  deserializeAttachment() {
    return structuredClone(this.data);
  }
  send(value: string) {
    this.messages.push(JSON.parse(value));
  }
  close(code: number) {
    this.closeCode = code;
    this.readyState = 3;
  }
}
let sockets: Socket[], room: FamilyCallRoomCore, env: any;
const NativeResponse = Response;
beforeEach(() => {
  jest.mocked(callActorAllowed).mockResolvedValue(true);
  sockets = [];
  (globalThis as any).WebSocketPair = class {
    0 = new Socket();
    1 = new Socket();
  };
  globalThis.Response = function (body: unknown, init: any) {
    if (init?.status === 101) {
      const response = new NativeResponse(null);
      Object.defineProperty(response, "status", { value: 101 });
      return response;
    }
    return new NativeResponse(body as any, init);
  } as any;
  env = {
    CALLING_ENABLED: "1",
    SHARED_DEVICE_ENABLED: "1",
    JWT_SECRET: secret,
    NEXT_PUBLIC_APP_URL: origin,
    DB: {},
  };
  room = new FamilyCallRoomCore(
    {
      acceptWebSocket: (s) => sockets.push(s as unknown as Socket),
      getWebSockets: () => sockets as unknown as CallSocket[],
    },
    env,
  );
});
afterEach(() => {
  globalThis.Response = NativeResponse;
  jest.restoreAllMocks();
});
async function join(user: string, familyId = "family-a") {
  const cookie = "cookie-" + user,
    now = Date.now();
  const grant: CallGrant = {
    kind: "person",
    userId: user,
    generation: 0,
    familyId,
    label: user,
    endpointId: crypto.randomUUID(),
    origin,
    cookieHash: callCookieHash(cookie),
    issuedAt: now,
    expiresAt: now + 60000,
    purpose: "family-call-v1",
  };
  const response = await room.fetch(
    new Request(origin + "/api/calls/socket", {
      headers: {
        Origin: origin,
        Cookie: "session_token=" + cookie,
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol":
          "herewoven.calls.v1, " + signCallGrant(grant, secret),
      },
    }),
  );
  return {
    status: response.status,
    socket: sockets[sockets.length - 1],
    id: grant.endpointId,
  };
}
const send = (s: Socket, m: unknown) =>
  room.webSocketMessage(s as unknown as CallSocket, JSON.stringify(m));
const last = (s: Socket, type: string) =>
  [...s.messages].reverse().find((m) => m.type === type);
it("admits only the room household and never exposes a foreign endpoint", async () => {
  const a = await join("a");
  expect(a.status).toBe(101);
  expect((await join("foreign", "family-b")).status).toBe(409);
  expect(sockets).toHaveLength(1);
  expect(last(a.socket, "presence").endpoints).toEqual([]);
});
it("coordinates ringing, duplicate/busy attempts, membership and close cleanup", async () => {
  const a = await join("a"),
    b = await join("b"),
    c = await join("c");
  await send(a.socket, { type: "call", target: b.id, mode: "voice" });
  const id = last(b.socket, "ringing").callId;
  expect(last(b.socket, "ringing").incoming).toBe(true);
  await send(c.socket, { type: "call", target: b.id, mode: "voice" });
  expect(last(c.socket, "error").code).toBe("busy");
  await send(b.socket, { type: "accept", callId: id, mode: "video" });
  expect(last(b.socket, "error").code).toBe("invalid");
  await send(b.socket, { type: "accept", callId: id, mode: "voice" });
  expect(last(a.socket, "accepted").initiator).toBe(true);
  const signal = {
    type: "offer",
    sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
  };
  await send(c.socket, { type: "signal", callId: id, signal });
  expect(last(b.socket, "signal")).toBeUndefined();
  await send(a.socket, { type: "signal", callId: id, signal });
  expect(last(b.socket, "signal").signal).toEqual(signal);
  await room.webSocketClose(b.socket as unknown as CallSocket);
  expect(last(a.socket, "ended").reason).toBe("unavailable");
});
it("downgrades video to voice before accepting SDP and preserves state across hibernation", async () => {
  const a = await join("a"),
    b = await join("b");
  await send(a.socket, { type: "call", target: b.id, mode: "video" });
  const id = last(b.socket, "ringing").callId;
  room = new FamilyCallRoomCore(
    {
      acceptWebSocket: () => undefined,
      getWebSockets: () => sockets as unknown as CallSocket[],
    },
    env,
  );
  await send(b.socket, { type: "accept", callId: id, mode: "voice" });
  expect(last(a.socket, "accepted").mode).toBe("voice");
  await send(a.socket, {
    type: "signal",
    callId: id,
    signal: { type: "offer", sdp: "v=0\r\nm=video 9 RTP/SAVPF 96\r\n" },
  });
  expect(last(a.socket, "error").code).toBe("invalid");
  expect(last(b.socket, "signal")).toBeUndefined();
  await send(a.socket, { type: "end", callId: id });
  expect(last(b.socket, "ended").callId).toBe(id);
});
it("does not resurrect an expired call or admit a revoked peer", async () => {
  const a = await join("a"),
    b = await join("b");
  await send(a.socket, { type: "call", target: b.id, mode: "voice" });
  const id = last(b.socket, "ringing").callId;
  const now = Date.now();
  jest.spyOn(Date, "now").mockReturnValue(now + 31000);
  await send(b.socket, { type: "accept", callId: id, mode: "voice" });
  expect(last(a.socket, "ended").reason).toBe("timeout");
  expect((b.socket.data as any).call).toBeUndefined();
  jest
    .mocked(callActorAllowed)
    .mockImplementation(
      async (_db, actor) => actor.kind === "person" && actor.userId !== "b",
    );
  await send(b.socket, { type: "heartbeat" });
  expect(b.socket.closeCode).toBe(4003);
});
it("refuses DND recipients and oversize messages", async () => {
  const a = await join("a"),
    b = await join("b");
  await send(b.socket, { type: "availability", dnd: true });
  await send(a.socket, { type: "call", target: b.id, mode: "video" });
  expect(last(a.socket, "error").code).toBe("busy");
  await room.webSocketMessage(
    a.socket as unknown as CallSocket,
    "x".repeat(32769),
  );
  expect(a.socket.closeCode).toBe(1009);
});
